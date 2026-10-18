extern "C" int remote(int);
namespace demo {
int data = 7;
int overload(int x) { return remote(x) + data; }
int overload(unsigned x) { return remote(x + 1) + data; }
static int local(int x) { return overload(x); }
int (*callback)(int) = overload;
int call() { return callback(local(data)) + overload(3u); }
}
extern "C" int entry() { return demo::call() + remote(2); }
extern "C" int alias_entry() __attribute__((alias("entry")));
int unused() { return remote(5); }
// A plain C name must not steal the location of demo::data.
extern "C" { int data = 13; }
