<script setup lang="ts">
import { ref } from 'vue'

import { EMOTION_VALUES } from '../../constants/emotions'

defineProps<{
  /** Expression the VRM shows now, or null when it rests on no emotion. */
  current?: string | null
  /** Variant of the current expression, when the model has several faces for it. */
  variant?: string | null
  /** Emotions the model has several faces for (from its expression metadata). */
  variants?: Record<string, string[]>
  /** Whether the think face is held for a pending reply. */
  holding?: boolean
  /** Whether a reply is open, so ACT emotions stay until it ends. */
  replyActive?: boolean
  /** Whether the panel simulates an open reply. */
  replySimulated?: boolean
  /** Reply emotion held as the resting face. */
  replyExpression?: string
}>()

const emit = defineEmits<{
  (e: 'emotion', name: string, intensity: number): void
  (e: 'expression', name: string, intensity: number): void
  (e: 'variant', emotion: string, variant: string, intensity: number): void
  (e: 'special', token: string): void
  (e: 'hold'): void
  (e: 'release'): void
  (e: 'simulateReply', active: boolean): void
  (e: 'close'): void
}>()

// Expressions of a VRoid model, plus Luna's custom think face.
const VRM_EXPRESSIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'think', 'neutral']

const intensity = ref(1)
const token = ref('<|ACT {"emotion":"happy"}|>')
</script>

<template>
  <div
    :class="[
      'absolute bottom-3 left-3 z-50 w-80 max-h-[85vh] overflow-y-auto',
      'flex flex-col gap-2 p-3',
      'rounded-xl text-xs',
      'bg-neutral-900/85 text-neutral-100 backdrop-blur',
      'shadow-lg',
    ]"
    @pointerdown.stop
  >
    <div class="flex items-center justify-between">
      <span class="font-semibold">Emotion debug</span>
      <button class="rounded px-1.5 hover:bg-neutral-700" title="Close (Ctrl+Shift+E)" @click="emit('close')">
        ✕
      </button>
    </div>

    <div class="text-neutral-300">
      VRM: <span class="text-white font-mono">{{ current ?? 'none' }}{{ variant ? ` · ${variant}` : '' }}</span>
      <span v-if="holding" class="ml-2 rounded bg-amber-600/80 px-1">holding think</span>
      <span v-if="replyActive" class="ml-2 rounded bg-emerald-700/80 px-1">reply{{ replyExpression ? `: ${replyExpression}` : '' }}</span>
    </div>

    <label class="flex items-center gap-2 text-neutral-300">
      <input type="checkbox" :checked="replySimulated" @change="emit('simulateReply', ($event.target as HTMLInputElement).checked)">
      Simulate reply (ACT emotions stay until unchecked, then fade in 3 s)
    </label>

    <label class="flex items-center gap-2">
      <span class="w-16 text-neutral-300">Intensity</span>
      <input v-model.number="intensity" type="range" min="0" max="1" step="0.05" class="flex-1">
      <span class="w-8 text-right font-mono">{{ intensity.toFixed(2) }}</span>
    </label>

    <div>
      <div class="mb-1 text-neutral-400">
        ACT emotions (stage queue)
      </div>
      <div class="grid grid-cols-3 gap-1">
        <button
          v-for="name in EMOTION_VALUES"
          :key="name"
          class="rounded bg-sky-800/80 px-1 py-1 hover:bg-sky-700"
          @click="emit('emotion', name, intensity)"
        >
          {{ name }}
        </button>
      </div>
    </div>

    <div v-if="variants && Object.keys(variants).length > 0">
      <div class="mb-1 text-neutral-400">
        Model variants (ACT emotions pick one at random)
      </div>
      <div class="flex flex-col gap-1">
        <div v-for="(names, emotion) in variants" :key="emotion" class="flex items-start gap-1">
          <span class="w-16 shrink-0 pt-1 text-neutral-400 font-mono">{{ emotion }}</span>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="name in names"
              :key="name"
              :class="[
                'rounded px-1.5 py-1',
                current === emotion && variant === name ? 'bg-teal-600' : 'bg-teal-800/80 hover:bg-teal-700',
              ]"
              @click="emit('variant', String(emotion), name, intensity)"
            >
              {{ name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="mb-1 text-neutral-400">
        VRM expressions (no mapping)
      </div>
      <div class="grid grid-cols-4 gap-1">
        <button
          v-for="name in VRM_EXPRESSIONS"
          :key="name"
          class="rounded bg-violet-800/80 px-1 py-1 hover:bg-violet-700"
          @click="emit('expression', name, intensity)"
        >
          {{ name }}
        </button>
      </div>
    </div>

    <div class="flex gap-1">
      <button class="flex-1 rounded bg-amber-700/80 py-1 hover:bg-amber-600" @click="emit('hold')">
        Hold think
      </button>
      <button class="flex-1 rounded bg-neutral-700 py-1 hover:bg-neutral-600" @click="emit('release')">
        Release
      </button>
    </div>

    <div>
      <div class="mb-1 text-neutral-400">
        Special token (parser path)
      </div>
      <div class="flex gap-1">
        <input
          v-model="token"
          class="min-w-0 flex-1 rounded bg-neutral-800 px-1.5 py-1 font-mono"
          style="font-variant-ligatures: none"
          spellcheck="false"
          @keydown.enter.stop="emit('special', token)"
          @keydown.stop
        >
        <button class="rounded bg-emerald-700/80 px-2 hover:bg-emerald-600" @click="emit('special', token)">
          Play
        </button>
      </div>
    </div>
  </div>
</template>
