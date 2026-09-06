<template>
  <div ref="root" class="language-switcher" :class="{ open }" @keydown.esc="close">
    <button
      type="button"
      class="language-trigger"
      :aria-label="menuLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click.stop="toggle"
    >
      <span class="language-current-flag" aria-hidden="true">{{ currentLanguage.flag }}</span>
      <span class="language-current-code">{{ currentLanguage.code }}</span>
      <Icon name="chevron-down" :size="13" />
    </button>

    <div v-if="open" :id="menuId" class="language-dropdown" role="listbox" :aria-label="menuLabel" @click.stop>
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="language-option"
        :class="{ selected: modelValue === option.value }"
        role="option"
        :aria-selected="modelValue === option.value"
        @pointerdown.stop.prevent="select(option.value)"
        @keydown.enter.prevent="select(option.value)"
        @keydown.space.prevent="select(option.value)"
      >
        <span class="language-option-flag" aria-hidden="true">{{ option.flag }}</span>
        <span class="language-option-copy">
          <strong>{{ option.label }}</strong>
          <small>{{ option.code }}</small>
        </span>
        <Icon v-if="modelValue === option.value" name="check" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import Icon from "./Icon.vue";

type Language = "zh" | "en" | "de";

const props = withDefaults(defineProps<{
  modelValue: Language;
  menuLabel?: string;
}>(), {
  menuLabel: "Language",
});

const emit = defineEmits<{
  "update:modelValue": [value: Language];
  change: [value: Language];
}>();

const options: Array<{ value: Language; code: string; label: string; flag: string }> = [
  { value: "zh", code: "ZH", label: "中文", flag: "🇨🇳" },
  { value: "en", code: "EN", label: "English", flag: "🇬🇧" },
  { value: "de", code: "DE", label: "Deutsch", flag: "🇩🇪" },
];

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const menuId = `language-menu-${Math.random().toString(36).slice(2, 9)}`;
const currentLanguage = computed(() => options.find((option) => option.value === props.modelValue) ?? options[0]);

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function select(value: Language) {
  emit("update:modelValue", value);
  emit("change", value);
  close();
}

function onDocumentPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onUnmounted(() => document.removeEventListener("pointerdown", onDocumentPointerDown));
</script>

<style scoped>
.language-switcher {
  position: relative;
  z-index: 20;
  flex: 0 0 auto;
  color: #006a64;
  font-family: inherit;
}

.language-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 70px;
  min-height: 32px;
  padding: 0 9px;
  color: #006a64;
  background: #e2f2ef;
  border: 1px solid #c8e6e1;
  border-radius: 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  transition: color .16s, background .16s, border-color .16s, box-shadow .16s;
}

.language-trigger:hover,
.language-switcher.open .language-trigger {
  color: #fff;
  background: #006a64;
  border-color: #006a64;
  box-shadow: 0 7px 16px rgba(0, 106, 100, .16);
}

.language-trigger .ui-icon {
  margin-left: auto;
  transition: transform .16s;
}

.language-switcher.open .language-trigger .ui-icon {
  transform: rotate(180deg);
}

.language-current-flag,
.language-option-flag {
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  line-height: 1;
}

.language-current-flag {
  font-size: 15px;
}

.language-current-code {
  letter-spacing: .02em;
}

.language-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(38px, max-content);
  align-items: start;
  align-content: start;
  gap: 3px;
  width: 218px;
  height: auto;
  max-height: none;
  padding: 7px;
  overflow: visible;
  background: #fff;
  border: 1px solid #dce9e5;
  border-radius: 13px;
  box-shadow: 0 16px 36px rgba(23, 60, 54, .18), 0 3px 8px rgba(23, 60, 54, .06);
  animation: language-menu-in .14s ease-out;
}

.language-option {
  display: flex;
  align-items: center;
  align-self: start;
  min-width: 0;
  gap: 8px;
  min-height: 38px;
  padding: 6px 8px;
  color: #344540;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: color .14s, background .14s, border-color .14s;
}

.language-option:hover,
.language-option:focus-visible,
.language-option.selected {
  color: #006a64;
  background: #edf8f5;
  border-color: #d4eee8;
}

.language-option-flag {
  flex: 0 0 auto;
  font-size: 17px;
}

.language-option-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  flex: 1;
  gap: 5px;
}

.language-option strong,
.language-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.language-option strong {
  font-size: 11px;
}

.language-option small {
  color: #91a19c;
  font-size: 9px;
  font-weight: 700;
}

.language-option > .ui-icon {
  flex: 0 0 auto;
}

@keyframes language-menu-in {
  from { opacity: 0; transform: translateY(-4px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

:global(html[data-theme="dark"]) .language-trigger,
:global(:root[data-theme="dark"]) .language-trigger {
  color: #a9d9d1;
  background: #203531;
  border-color: #38564f;
}

:global(html[data-theme="dark"]) .language-trigger:hover,
:global(html[data-theme="dark"]) .language-switcher.open .language-trigger,
:global(:root[data-theme="dark"]) .language-trigger:hover,
:global(:root[data-theme="dark"]) .language-switcher.open .language-trigger {
  color: #10201d;
  background: #69d2c7;
  border-color: #69d2c7;
}

:global(html[data-theme="dark"]) .language-dropdown,
:global(:root[data-theme="dark"]) .language-dropdown {
  background: #172321;
  border-color: #30413d;
  box-shadow: 0 16px 36px rgba(0, 0, 0, .32);
}

:global(html[data-theme="dark"]) .language-option,
:global(:root[data-theme="dark"]) .language-option {
  color: #d7e7e3;
}

:global(html[data-theme="dark"]) .language-option:hover,
:global(html[data-theme="dark"]) .language-option:focus-visible,
:global(html[data-theme="dark"]) .language-option.selected,
:global(:root[data-theme="dark"]) .language-option:hover,
:global(:root[data-theme="dark"]) .language-option:focus-visible,
:global(:root[data-theme="dark"]) .language-option.selected {
  color: #69d2c7;
  background: #203531;
  border-color: #38564f;
}

@media (max-width: 520px) {
  .language-trigger {
    min-width: 62px;
    min-height: 30px;
    padding-inline: 7px;
  }

  .language-dropdown {
    width: 200px;
  }
}
</style>
