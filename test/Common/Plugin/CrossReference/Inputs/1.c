int foo() { return 1; }
int bar() { return 2; }
int unused() { return foo() + 1; }
int deep_top();
int main() { return foo() + foo() + bar() + deep_top(); }
