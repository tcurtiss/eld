int foo() { return 1; }
int bar() { return 2; }
extern int baz();
int main() { return foo() + bar() + baz(); }
