// Address-only logging patterns. None of these strings is dereferenced.
// Verify that the matrix really compiles the requested small/large PIC/PIE
// model. Undefined PIC/PIE macros evaluate to zero in these #if expressions.
#if defined(EXPECT_PIC_LEVEL) && EXPECT_PIC_LEVEL != __PIC__
#error Wrong PIC model for this test case
#endif
#if defined(EXPECT_PIE_LEVEL) && EXPECT_PIE_LEVEL != __PIE__
#error Wrong PIE model for this test case
#endif

typedef __UINTPTR_TYPE__ uintptr_t;
#define LOCAL_STRING __attribute__((section(".dedup"), used))
#define AUX_STRING __attribute__((section(".dedup_aux"), used))
#define NOINLINE __attribute__((noinline, visibility("hidden")))

#ifdef __cplusplus
extern "C" {
#endif
NOINLINE uintptr_t emit_id(unsigned level, uintptr_t id, unsigned value);
NOINLINE uintptr_t emit_ptr(const char *id, unsigned value);
NOINLINE uintptr_t emit_pair(uintptr_t first, uintptr_t second);
NOINLINE uintptr_t emit_variadic(uintptr_t id, ...);
NOINLINE uintptr_t emit_many(unsigned a, unsigned b, unsigned c, unsigned d,
                             unsigned e, unsigned f, uintptr_t id);

#ifdef SECOND_OBJECT
// Definitions in another TU prevent constant folding through the callees.
uintptr_t emit_id(unsigned level, uintptr_t id, unsigned value) {
  __asm__ volatile("" : "+r"(id) : "r"(level), "r"(value));
  return id;
}
uintptr_t emit_ptr(const char *id, unsigned value) {
  __asm__ volatile("" : "+r"(id) : "r"(value));
  return (uintptr_t)id;
}
uintptr_t emit_pair(uintptr_t first, uintptr_t second) {
  __asm__ volatile("" : "+r"(first) : "r"(second));
  return first;
}
uintptr_t emit_variadic(uintptr_t id, ...) {
  __asm__ volatile("" : "+r"(id));
  return id;
}
uintptr_t emit_many(unsigned a, unsigned b, unsigned c, unsigned d, unsigned e,
                    unsigned f, uintptr_t id) {
  __asm__ volatile("" : "+r"(id) : "r"(a), "r"(f));
  return id;
}
uintptr_t other_tu(void) {
  static const char fmt[] LOCAL_STRING = "duplicate";
  return (uintptr_t)fmt;
}
#else
uintptr_t return_address(void) {
  static const char fmt[] LOCAL_STRING = "return";
  return (uintptr_t)fmt;
}
const char *return_pointer(void) {
  static const char fmt[] LOCAL_STRING = "pointer";
  return fmt;
}
uintptr_t array_address(void) {
  static const char fmt[] LOCAL_STRING = "array";
  return (uintptr_t)&fmt;
}
uintptr_t element_address(void) {
  static const char fmt[] LOCAL_STRING = "element";
  return (uintptr_t)&fmt[0];
}
uintptr_t interior_address(void) {
  static const char fmt[] LOCAL_STRING = "interior";
  return (uintptr_t)&fmt[2];
}
uintptr_t call_integer(unsigned value) {
  static const char fmt[] LOCAL_STRING = "integer argument";
  return emit_id(3, (uintptr_t)fmt, value);
}
uintptr_t call_pointer(unsigned value) {
  static const char fmt[] LOCAL_STRING = "pointer argument";
  return emit_ptr(fmt, value);
}
uintptr_t two_arguments(void) {
  static const char first[] LOCAL_STRING = "first argument";
  static const char second[] LOCAL_STRING = "second argument";
  return emit_pair((uintptr_t)first, (uintptr_t)second);
}
uintptr_t variadic_arguments(unsigned value) {
  static const char fmt[] LOCAL_STRING = "variadic";
  return emit_variadic((uintptr_t)fmt, value, 2, 3, 4, 5, 6, 7);
}
uintptr_t stack_argument(unsigned value) {
  static const char fmt[] LOCAL_STRING = "stack argument";
  return emit_many(value, 2, 3, 4, 5, 6, (uintptr_t)fmt);
}
uintptr_t indirect_call(uintptr_t (*callback)(uintptr_t)) {
  static const char fmt[] LOCAL_STRING = "indirect";
  return callback((uintptr_t)fmt);
}
uintptr_t reuse_address(unsigned value) {
  static const char fmt[] LOCAL_STRING = "reuse";
  emit_id(1, (uintptr_t)fmt, value);
  return emit_id(2, (uintptr_t)fmt, value + 1);
}
void store_address(volatile uintptr_t *out) {
  static const char fmt[] LOCAL_STRING = "store";
  *out = (uintptr_t)fmt;
}

#define LOG_ID(TEXT, VALUE)                                                    \
  do {                                                                         \
    static const char fmt[] LOCAL_STRING = TEXT;                               \
    emit_id(4, (uintptr_t)fmt, VALUE);                                         \
  } while (0)
void repeated_macro(unsigned value) {
  LOG_ID("macro first", value);
  LOG_ID("macro second", value + 1);
  LOG_ID("duplicate", value + 2);
}

#define STRING_ID(TEXT)                                                        \
  __extension__({                                                              \
    static const char fmt[] LOCAL_STRING = TEXT;                               \
    (uintptr_t)fmt;                                                            \
  })
uintptr_t expression_macro(void) {
  return emit_pair(STRING_ID("expression first"),
                   STRING_ID("expression second"));
}
uintptr_t nested_scopes(unsigned choose) {
  if (choose) {
    static const char fmt[] LOCAL_STRING = "nested first";
    return emit_id(1, (uintptr_t)fmt, choose);
  } else {
    static const char fmt[] LOCAL_STRING = "nested second";
    return emit_id(2, (uintptr_t)fmt, choose);
  }
}
uintptr_t other_section(void) {
  static const char fmt[] AUX_STRING = "duplicate";
  return (uintptr_t)fmt;
}
uintptr_t empty_string(void) {
  static const char fmt[] LOCAL_STRING = "";
  return (uintptr_t)fmt;
}
uintptr_t embedded_nul(void) {
  static const char fmt[] LOCAL_STRING = "A\0B";
  return (uintptr_t)fmt;
}
static inline __attribute__((always_inline)) uintptr_t inline_id(void) {
  static const char fmt[] LOCAL_STRING = "inline";
  return (uintptr_t)fmt;
}
uintptr_t inline_caller(void) { return emit_id(7, inline_id(), 8); }

// Control: a normal, non-DSECT string must keep its ordinary PIC addressing.
const char *ordinary_address(void) {
  static const char ordinary[] = "ordinary control";
  return ordinary;
}
#endif
#ifdef __cplusplus
} // extern "C"

#ifndef SECOND_OBJECT
template<unsigned Level> static uintptr_t template_id(unsigned value) {
  static const char fmt[] LOCAL_STRING = "template";
  return emit_id(Level, reinterpret_cast<uintptr_t>(fmt), value);
}
extern "C" uintptr_t template_caller(unsigned value) {
  return template_id<3>(value);
}
extern "C" uintptr_t lambda_caller(unsigned value) {
  auto log = [](unsigned v) {
    static const char fmt[] LOCAL_STRING = "lambda";
    return emit_id(5, reinterpret_cast<uintptr_t>(fmt), v);
  };
  return log(value);
}
#endif
#endif
