volatile const int deep_const_data = 7;
volatile int deep_rw_data = 11;
volatile int deep_bss_data;

__attribute__((weak)) int weak_data_symbol = 13;
__attribute__((weak)) int weak_function_symbol() { return 19; }
__attribute__((weak)) int weak_unoverridden_data = 31;
__attribute__((weak)) int weak_unoverridden_function() { return 37; }

int deep_leaf() { return 17; }
int deep_mid() { return deep_leaf(); }
int deep_top() {
  return deep_mid() + deep_leaf() + deep_const_data + deep_rw_data +
         deep_bss_data + weak_data_symbol + weak_function_symbol() +
         weak_unoverridden_data + weak_unoverridden_function();
}
