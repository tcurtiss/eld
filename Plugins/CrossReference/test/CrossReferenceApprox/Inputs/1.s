	.text
	.section	.text.mixed,"ax",@progbits
	.globl	bar                             // -- Begin function bar
	.falign
	.type	bar,@function
bar:                                    // @bar, deliberately no .size directive
// %bb.0:                               // %entry
	{
		allocframe(r29,#8):raw
	}
	{
		memw(r30+#-4) = r0
	}
	{
		r0 = #0
	}
	{
		r31:30 = dealloc_return(r30):raw
	}
                                        // -- End function bar
	.globl	foo                             // -- Begin function foo, deliberately no .size directive
	.falign
	.type	foo,@function
foo:                                    // @foo
// %bb.0:                               // %entry
	{
		allocframe(r29,#0):raw
	}
	{
		call bar
	}
	{
		r0 = #0
	}
	{
		r31:30 = dealloc_return(r30):raw
	}
                                        // -- End function foo
	.section	".note.GNU-stack","",@progbits
