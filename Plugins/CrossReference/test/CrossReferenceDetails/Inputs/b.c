int external_data = 4;
int remote(int x) { return x + external_data; }
__attribute__((weak)) int weak_data = 3;
__attribute__((weak)) int weak_function(void) { return weak_data; }
static int local(int x) { return x + 1; }
int other(void) { return local(weak_function()); }
