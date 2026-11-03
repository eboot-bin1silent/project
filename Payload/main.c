#include <ps4.h>

// تعريف دوال الـ BGFT الخاصة بنظام PS4 لإضافة مهام التحميل
extern int sceBgftServiceOpen(int *serviceHandle);
extern int sceBgftServiceClose(int serviceHandle);
extern int sceBgftServiceDownloadRegisterTask(int serviceHandle, void *params, int *taskId);

// الهيكل البرمجي (Structure) الذي يفهمه نظام PS4 لتمرير بيانات التحميل
struct bgft_download_params {
    uint32_t size;          // حجم الهيكل البرمجي
    uint32_t user_id;       // معرف المستخدم (غالباً 0)
    int32_t  simultaneous;  // التحميل الفوري (1 نعم)
    const char *url;        // الرابط المباشر لملف الـ PKG
    const char *name;       // الاسم المعروض في قائمة التنبيهات
    // هناك متغيرات أخرى فرعية تعتمد على إصدار النظام يتم تهيئتها بـ 0
    uint8_t  reserved[128]; 
};

int _main(struct thread *td) {
    // 1. تهيئة مكتبات النظام والوصول للنواة
    initKernel();
    initLibc();
    
    // تحميل مكتبة libsysutil للتعامل مع مهام الخلفية والرسائل
    int sysUtilHandle = sceSysmoduleLoadModule(0x009A); // معرف مكتبة SysUtil
    
    int serviceHandle = 0;
    int taskId = 0;
    
    // 2. فتح خدمة التحميل في الخلفية (Bgft Service)
    if (sceBgftServiceOpen(&serviceHandle) == 0) {
        
        // 3. إعداد بيانات ملف الـ PKG المراد تحميله
        struct bgft_download_params params;
        memset(&params, 0, sizeof(params));
        
        params.size = sizeof(params);
        params.user_id = 0x10000000; // المعرف الافتراضي للمستخدم الأول
        params.simultaneous = 1;
        
        // اأدخل هنا الرابط المباشر لملف الـ PKG الخاص بك
        params.url = "https://archive.org/download/ps4-fpkg-collection-english-j/Journey%20-%20[US]%20[EN]%20[1.01].pkg"; 
        params.name = "My Custom App Installer";
        
        // 4. تسجيل المهمة وإعطاء أمر البدء للنظام
        sceBgftServiceDownloadRegisterTask(serviceHandle, &params, &taskId);
        
        // 5. إغلاق اتصال الخدمة بعد إرسال الأمر بنجاح
        sceBgftServiceClose(serviceHandle);
        
        // إظهار إشعار للمستخدم بأن التحميل بدأ
        sceSysUtilSendMessage("Direct Download Started!", 0);
    } else {
        sceSysUtilSendMessage("Failed to open BGFT Service.", 0);
    }
    
    return 0;
}
