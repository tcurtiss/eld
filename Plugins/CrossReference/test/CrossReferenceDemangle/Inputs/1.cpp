namespace ns {
int foo(int x) { return x + 1; }
int bar(int x, int y) { return foo(x) + foo(y); }
} // namespace ns

int main() { return ns::bar(1, 2); }
