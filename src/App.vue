<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import WebApp from '@twa-dev/sdk'
import { isTelegramMiniAppEnvironment } from './lib/telegramEnv'
import ChartApp from './ChartApp.vue'

function detectTelegramMiniApp(): boolean {
  if (import.meta.env.DEV) return true
  return isTelegramMiniAppEnvironment()
}

const showChartApp = ref(detectTelegramMiniApp())

function notifyTelegramReady() {
  if (import.meta.env.DEV) return
  if (!showChartApp.value) return
  try {
    WebApp.ready()
  } catch {
    /* no-op */
  }
}

watch(showChartApp, (ok) => {
  if (ok) notifyTelegramReady()
})

onMounted(() => {
  const recheck = () => {
    if (import.meta.env.DEV) {
      showChartApp.value = true
      return
    }
    if (!showChartApp.value) {
      showChartApp.value = detectTelegramMiniApp()
    }
  }

  recheck()
  queueMicrotask(recheck)
  setTimeout(recheck, 0)
  setTimeout(recheck, 50)
  setTimeout(recheck, 200)

  notifyTelegramReady()
})
</script>

<template>
  <div
    v-if="!showChartApp"
    class="relative flex min-h-[100dvh] min-w-0 max-w-[100vw] flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]"
  >
    <!-- Фон -->
    <div
      class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(34,158,217,0.25),transparent_50%),radial-gradient(ellipse_80%_60%_at_100%_100%,rgba(59,130,246,0.12),transparent_45%),linear-gradient(165deg,#0a0f1a_0%,#111827_45%,#0f172a_100%)]"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -right-20 top-1/4 h-[28rem] w-[28rem] rounded-full bg-[#229ED9]/[0.12] blur-[100px]"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute -left-24 bottom-0 h-[22rem] w-[22rem] rounded-full bg-indigo-500/[0.08] blur-[90px]"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px] opacity-40 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]"
      aria-hidden="true"
    />

    <div class="relative z-10 flex w-full max-w-md flex-col items-center text-center">
      <!-- Иконка -->
      <div
        class="mb-8 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-[#2AABEE] to-[#229ED9] shadow-[0_20px_50px_-12px_rgba(34,158,217,0.45),inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-white/10"
      >
        <svg
          class="h-10 w-10 text-white drop-shadow-sm"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </div>

      <p
        class="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5dadec]"
      >
        Mini App
      </p>
      <h1 class="text-balance text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]">
        Откройте в Telegram
      </h1>
      <p class="mt-4 text-pretty text-[15px] leading-relaxed text-slate-400">
        Это приложение работает только внутри Telegram. Перейдите к боту и запустите его из чата —
        так вы получите полный доступ к графикам и настройкам.
      </p>

      <a
        href="https://t.me/postigator_lab_bot"
        class="group mt-10 inline-flex w-full max-w-sm items-center justify-center gap-2.5 rounded-2xl bg-[#229ED9] px-6 py-4 text-[15px] font-semibold text-white shadow-[0_12px_40px_-8px_rgba(34,158,217,0.55)] ring-1 ring-white/10 transition hover:bg-[#1f8fc7] hover:shadow-[0_16px_44px_-8px_rgba(34,158,217,0.6)] active:scale-[0.98] sm:w-auto"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg
          class="h-5 w-5 shrink-0 opacity-90 transition group-hover:translate-x-0.5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"
          />
        </svg>
        Перейти к боту
        <svg
          class="h-4 w-4 shrink-0 opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </a>

      <p class="mt-10 max-w-xs text-center text-xs leading-relaxed text-slate-500">
        Ссылка откроется в приложении Telegram, если оно установлено на устройстве.
      </p>
    </div>
  </div>
  <ChartApp v-else />
</template>
