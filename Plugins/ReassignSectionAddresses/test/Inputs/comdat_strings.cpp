typedef __UINTPTR_TYPE__ uintptr_t;

// The function and its local static have external ODR linkage and are emitted
// in both TUs. Hidden visibility keeps the selected string non-preemptible.
__attribute__((noinline, visibility("hidden"))) inline uintptr_t common_id() {
  static const char fmt[] __attribute__((used, section(".dedup"))) = "comdat";
  return (uintptr_t)fmt;
}

#ifdef SECOND_OBJECT
extern "C" uintptr_t from_b() { return common_id(); }
#else
extern "C" uintptr_t from_a() { return common_id(); }
#endif
