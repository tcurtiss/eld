.text
.p2align 2
.ifdef SECOND_OBJECT
.globl merge_b
.type merge_b,@function
merge_b:
.else
.globl merge_a
.type merge_a,@function
merge_a:
.endif
  { r0 = add(pc,##fmt@PCREL) }
  { jumpr r31 }
.ifdef SECOND_OBJECT
.size merge_b, .-merge_b
.else
.size merge_a, .-merge_a
.endif
.section .dedup,"aMS",@progbits,1
.local fmt
.type fmt,@object
fmt: .asciz "merge"
.size fmt, .-fmt
