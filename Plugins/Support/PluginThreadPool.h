#ifndef ELD_PLUGIN_THREAD_POOL_COMPAT_H
#define ELD_PLUGIN_THREAD_POOL_COMPAT_H
#if __has_include("eld/PluginAPI/ThreadPool.h")
#include "eld/PluginAPI/ThreadPool.h"
#else
#include <ELD/PluginAPI/ThreadPool.h>
#endif
#endif
