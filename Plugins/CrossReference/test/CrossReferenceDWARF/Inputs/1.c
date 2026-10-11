int global_data = 3;
int foo() { return 1; }
int bar() { return 2; }
int main() { return foo() + bar() + global_data; }
