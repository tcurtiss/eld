int foo() { return 1; }
int bar() { return 2; }
int unused() { return foo() + 1; }
int main() { return foo() + bar(); }
