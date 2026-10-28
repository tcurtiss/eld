.section .text.aaa,"ax",@progbits
.p2align 2
.globl relaxed_id
.type relaxed_id,@function
relaxed_id:
  { r0 = add(pc,##fmt@PCREL) }
  { jump continuation }
.size relaxed_id, .-relaxed_id
.section .text.bbb,"ax",@progbits
.p2align 2
.globl continuation
.hidden continuation
.type continuation,@function
continuation:
  { jumpr r31 }
.size continuation, .-continuation
.section .dedup,"a",@progbits
.local fmt
.type fmt,@object
fmt: .asciz "relax"
.size fmt, .-fmt
