extern int b_fn();
int local_fn() { return 1; }
int calls_local() { return local_fn(); }
int calls_remote() { return b_fn(); }
int main() { return calls_local() + calls_remote(); }
