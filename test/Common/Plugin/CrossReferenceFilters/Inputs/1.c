static int helper() { return 42; }
char tiny[1] = {1};
char large[64];
int callee_many() { return 7; }
int callee_once() { return 3; }
int caller1() { return callee_many(); }
int caller2() { return callee_many() + callee_once(); }
int main() {
  return helper() + tiny[0] + large[0] + caller1() + caller2();
}
