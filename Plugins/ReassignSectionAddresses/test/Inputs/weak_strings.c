typedef __UINTPTR_TYPE__ uintptr_t;
#define HIDDEN __attribute__((visibility("hidden")))
#define STRING __attribute__((used, section(".dedup")))
#ifdef __cplusplus
extern "C" {
#endif
extern const char weak_id[] HIDDEN;
extern const char own_id[] HIDDEN;
#ifdef SECOND_OBJECT
const char weak_id[] STRING = "strong";
#else
const char weak_id[] STRING __attribute__((weak)) = "weak";
const char own_id[] STRING = "alias";
extern const char alias_id[6] HIDDEN __attribute__((alias("own_id")));
uintptr_t use_weak(void) { return (uintptr_t)weak_id; }
uintptr_t use_alias(void) { return (uintptr_t)alias_id; }
#endif
#ifdef __cplusplus
}
#endif
