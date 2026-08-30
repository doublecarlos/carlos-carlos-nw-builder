<script setup lang="ts">
import BaseModal from "./ui/BaseModal.vue";
import { ExternalLink } from "@lucide/vue";
import { APP_VERSION, DISCLAIMER, ISSUES_URL, REPO_URL } from "../lib/app-info";

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
        <p class="font-semibold">Carlos Carlos' NW Builder</p>
        <p class="text-muted" data-testid="about-version">
          Version {{ APP_VERSION }}
        </p>
        <p class="text-muted">
          A build planner for Neverwinter. Everything runs in your browser -- no
          account, no server, nothing sent anywhere.
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
      </div>

      <p
        class="border-t border-line pt-3 text-xs text-muted"
        data-testid="about-disclaimer"
      >
        {{ DISCLAIMER }}
        <br />
        Released under the MIT licence.
      </p>
    </div>
  </BaseModal>
</template>
