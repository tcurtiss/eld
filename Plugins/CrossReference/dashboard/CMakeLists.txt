# The dashboard is developed alongside its exporter, but Node is optional for
# builds that only need the C++ plugin. No npm packages or browser are required.
option(CROSSREFERENCE_BUILD_DASHBOARD
  "Build the CrossReference dashboard and expose its development checks" ON)
if(NOT CROSSREFERENCE_BUILD_DASHBOARD)
  return()
endif()
find_program(CROSSREFERENCE_DASHBOARD_NODE NAMES node nodejs
  DOC "Node.js 18 or newer for CrossReference dashboard builds and checks")
if(NOT CROSSREFERENCE_DASHBOARD_NODE)
  message(STATUS "CrossReference dashboard targets disabled: Node.js not found")
  return()
endif()
execute_process(
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" -p
    "Number(process.versions.node.split('.')[0])"
  RESULT_VARIABLE _node_status OUTPUT_VARIABLE _node_major
  OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
if(NOT _node_status EQUAL 0 OR NOT _node_major MATCHES "^[0-9]+$"
    OR _node_major LESS 18)
  message(STATUS "CrossReference dashboard targets disabled: Node.js 18 or newer required")
  return()
endif()

set(_dashboard_html "${CMAKE_CURRENT_BINARY_DIR}/image-anatomy.html")
set(_dashboard_sources src/page.html src/core.js src/relationships.js
  src/explorer.js src/ui.js tools/build.js)
add_custom_command(OUTPUT "${_dashboard_html}"
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tools/build.js" --out "${_dashboard_html}"
  DEPENDS ${_dashboard_sources}
  COMMENT "Building CrossReference image analysis dashboard"
  VERBATIM)
add_custom_target(CrossReferenceDashboard ALL DEPENDS "${_dashboard_html}")

add_custom_target(check-crossreference-dashboard
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-details.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-relationships.js
  COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}" tools/check-build.js
  DEPENDS CrossReferenceDashboard
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  USES_TERMINAL VERBATIM)

if(BUILD_TESTING)
  foreach(_check check check-details check-relationships check-build)
    add_test(NAME "CrossReferenceDashboard.${_check}"
      COMMAND "${CROSSREFERENCE_DASHBOARD_NODE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tools/${_check}.js")
  endforeach()
  if(ELD_STANDALONE AND TARGET CrossReference)
    eld_add_standalone_test(
      NAME CrossReferenceDashboard TARGET CrossReference
      SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/../test/dashboard_test.py"
      ARGS --node "${CROSSREFERENCE_DASHBOARD_NODE}"
        --output-dir "${CMAKE_CURRENT_BINARY_DIR}/exports")
    add_dependencies(check-crossreference-dashboard CrossReference)
    add_custom_command(TARGET check-crossreference-dashboard POST_BUILD
      COMMAND "${CMAKE_CTEST_COMMAND}" --test-dir "${CMAKE_BINARY_DIR}"
        -C "$<CONFIG>" --output-on-failure
        -R "^ELDStandalone.CrossReferenceDashboard$"
      USES_TERMINAL VERBATIM)
  endif()
endif()
message(STATUS "CrossReference dashboard: ${_dashboard_html}")
