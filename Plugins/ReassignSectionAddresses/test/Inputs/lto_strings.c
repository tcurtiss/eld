typedef __UINTPTR_TYPE__ uintptr_t;
#define ID_FUNCTION __attribute__((used, noinline))
#define ID_STRING __attribute__((used, section(".dedup")))
#ifdef __cplusplus
extern "C" {
#endif
#ifdef SECOND_OBJECT
ID_FUNCTION uintptr_t test_b(void) {
  static const char fmt[] ID_STRING = "beta";
  return (uintptr_t)fmt;
}
ID_FUNCTION uintptr_t test_duplicate(void) {
  static const char fmt[] ID_STRING = "alpha";
  return (uintptr_t)fmt;
}
#else
ID_FUNCTION uintptr_t test_a(void) {
  static const char fmt[] ID_STRING = "alpha";
  return (uintptr_t)fmt;
}
#endif
#ifdef __cplusplus
}
#endif
