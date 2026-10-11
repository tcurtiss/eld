#ifndef ELD_PLUGIN_API_COMPAT_H
#define ELD_PLUGIN_API_COMPAT_H

// The source-tree API uses the lower-case eld/ include layout. Installed
// Hexagon packages use ELD/. This distinction also identifies the optional
// tracing helper that was added after the first 23.0 package.
#if __has_include("eld/PluginAPI/LinkerWrapper.h")
#define ELD_PLUGIN_HAS_TRACE_HELPER 1
#else
#define ELD_PLUGIN_HAS_TRACE_HELPER 0
#endif

#endif
