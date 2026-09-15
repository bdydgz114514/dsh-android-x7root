/** Host loader entry for the DSH mobile custom settings section (browser half in ./client). */
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "client-ui-settings-custom";
const inject = [];

/** No host-side behavior: the custom settings page is entirely a browser plugin. */
function apply() {}

export { apply, inject, name };
