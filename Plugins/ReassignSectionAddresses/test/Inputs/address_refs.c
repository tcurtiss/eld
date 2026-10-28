typedef __UINTPTR_TYPE__ uintptr_t;

#ifdef __cplusplus
extern "C" {
#endif

#ifdef SECOND_OBJECT
uintptr_t third(void) {
  static const char fmt[] __attribute__((section(".dedup"), used)) = "first";
  return (uintptr_t)fmt;
}
#else
uintptr_t first(void) {
  static const char fmt[] __attribute__((section(".dedup"), used)) = "first";
  return (uintptr_t)fmt;
}

uintptr_t second(void) {
  static const char fmt[] __attribute__((section(".dedup"), used)) = "second";
  return (uintptr_t)fmt;
}
#endif

#ifdef __cplusplus
}
#endif
