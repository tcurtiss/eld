/* Data-only fixtures for ReassignSectionAddresses.  The linker script places
 * these sections in DSECT output sections so their reassigned addresses are
 * bookkeeping values and do not affect loadable image layout. */

__attribute__((section(".reassign_a"), used))
const char same_a[] = "same";

__attribute__((section(".reassign_a"), used))
const char other_a[] = "other";

__attribute__((section(".reassign_a"), used))
const char same_a_duplicate[] = "same";

__attribute__((section(".reassign_b"), used))
const char same_b[] = "same";

__attribute__((section(".reassign_b"), used))
const char third_b[] = "third";

int main(void) { return 0; }
