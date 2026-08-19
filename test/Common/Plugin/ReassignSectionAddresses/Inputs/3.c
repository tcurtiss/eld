// Symbols with three different bindings (global, weak, local), used to check
// that setSymbolAddress()/the plugin's absolute-address reassignment
// preserves each symbol's original binding rather than forcing it to global,
// which is what an absolute symbol's binding used to be hard-coded to.
__attribute__((section(".randomized_addrs"), used)) const char gsym[] =
    "global one";
__attribute__((section(".randomized_addrs"), used, weak)) const char wsym[] =
    "weak one";
static __attribute__((section(".randomized_addrs"), used)) const char
    lsym[] = "local one";

const char *getGSymPtr() { return gsym; }
const char *getWSymPtr() { return wsym; }
const char *getLSymPtr() { return lsym; }
