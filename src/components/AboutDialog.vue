<script setup lang="ts">
import BaseModal from "./ui/BaseModal.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import { ExternalLink } from "@lucide/vue";
import {
  APP_COMMIT,
  APP_VERSION,
  DISCLAIMER,
  ISSUES_URL,
  REPO_URL,
} from "../lib/app-info";
import { enabled as maintainerEnabled } from "../stores/maintainer";

defineEmits<{ close: [] }>();
</script>

<template>
  <BaseModal
    title="About"
    panel-class="max-h-[80vh] w-[460px]"
    data-testid="about-dialog"
    @close="$emit('close')"
  >
    <div class="flex flex-col gap-4 overflow-y-auto p-4">
      <div class="flex flex-col gap-1">
        <p class="text-lg font-semibold">Carlos Carlos' NW Builder</p>
        <p data-testid="about-version">
          Version {{ APP_VERSION }} (build {{ APP_COMMIT }})
        </p>
        <p>
          A build planner for Neverwinter. <br />
          Everything runs locally in your browser.
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <a
          class="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
          :href="REPO_URL"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="about-repo-link"
        >
          <ExternalLink class="size-[14px]" />
          Source code
        </a>
        <a
          class="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
          :href="ISSUES_URL"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="about-issues-link"
        >
          <ExternalLink class="size-[14px]" />
          Report a problem
        </a>
        <!-- A plain file in public/, not a route: it has to stay readable when the bundle
             does not, and a new tab keeps the builder open behind it. -->
        <a
          class="inline-flex w-fit items-center gap-1.5 text-accent hover:underline"
          href="/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="about-privacy-link"
        >
          <ExternalLink class="size-[14px]" />
          Privacy
        </a>
      </div>

      <!-- The one place the maintainer flag can be turned back off: `?maintainer=1` sets it
           but does not stay in the URL, so without this it would be unreachable to anyone
           who had not memorised the param. -->
      <div class="flex flex-col gap-1 border-t border-line pt-3">
        <BaseCheckbox
          v-model="maintainerEnabled"
          data-testid="about-maintainer"
        >
          Maintainer tools
        </BaseCheckbox>
        <p>
          Enables tools to re-export data files. Mostly useful if you have a
          clone of the source code.
        </p>
      </div>

      <p
        class="border-t border-line pt-3 text-muted"
        data-testid="about-disclaimer"
      >
        {{ DISCLAIMER }}
        <br />
        Released under the MIT license.
      </p>
    </div>
  </BaseModal>
</template>
