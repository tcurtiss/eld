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
extern "C" const char *fragment_unique = "fragment unique";

// Deliberately emit a data relocation against a code *section* symbol plus an
// addend. The CrossReference target resolver must recover asm_target from the
// target chunk/range rather than leave this as a section-only destination.
asm(".section .text.section_target,\"ax\",@progbits\n"
    ".globl asm_target\n"
    ".type asm_target,@function\n"
    "asm_target:\n"
    "  .word 0\n"
    "  .word 0\n"
    ".size asm_target, .-asm_target\n"
    ".section .data.section_ref,\"aw\",@progbits\n"
    ".globl code_section_ref\n"
    ".type code_section_ref,@object\n"
    "code_section_ref:\n"
    "  .word .text.section_target+4\n"
    ".size code_section_ref, .-code_section_ref\n"
    ".globl code_section_nearest\n"
    ".type code_section_nearest,@object\n"
    "code_section_nearest:\n"
    "  .word .text.section_target+12\n"
    ".size code_section_nearest, .-code_section_nearest\n"
    ".globl code_section_dwarf\n"
    ".type code_section_dwarf,@object\n"
    "code_section_dwarf:\n"
    "  .word .text\n"
    ".size code_section_dwarf, .-code_section_dwarf\n"
    ".text\n");
