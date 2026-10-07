static int local_data = 7;
int global_data = 3;
int common_data;
int *global_ptr = &global_data;

__attribute__((noinline)) static int local_fn(void) { return local_data; }
__attribute__((noinline)) int target(void) { return 11; }
__attribute__((noinline)) int caller(void) {
  return target() + target() + local_fn();
}
__attribute__((noinline, section(".text.keepme"))) int kept(void) { return 9; }
__attribute__((noinline)) int unused(void) { return 13; }
__attribute__((noinline)) int self_ref(int n) {
  return n ? self_ref(n - 1) : 0;
}

extern int remote(void);
int main(void) { return caller() + remote() + global_data; }
