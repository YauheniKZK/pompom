import WebApp from '@twa-dev/sdk'
import { createI18n } from 'vue-i18n'

export type AppLocale = 'ru' | 'en'

const STORAGE_KEY = 'app-locale'

export function normalizeLocale(value: unknown): AppLocale {
  const raw = String(value ?? '').toLowerCase()
  return raw.startsWith('ru') ? 'ru' : 'en'
}

function detectInitialLocale(): AppLocale {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return normalizeLocale(saved)
  }

  const tgLang = WebApp.initDataUnsafe?.user?.language_code
  if (tgLang) return normalizeLocale(tgLang)

  if (typeof navigator !== 'undefined') {
    return normalizeLocale(navigator.language)
  }
  return 'en'
}

export function persistLocale(locale: AppLocale) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, locale)
}

export const messages = {
  ru: {
    language: 'Язык',
    app: {
      miniApp: 'Mini App',
      openInTelegram: 'Откройте в Telegram',
      fallbackDescription:
        'Это приложение работает только внутри Telegram. Перейдите к боту и запустите его из чата — так вы получите полный доступ к графикам и настройкам.',
      openBot: 'Перейти к боту',
      fallbackHint: 'Ссылка откроется в приложении Telegram, если оно установлено на устройстве.',
    },
    chart: {
      defaultTitle: 'Top Sales by Year',
      defaultDescription: 'Анимированный рейтинг по периодам',
      settingsTitle: 'Настройки Postigator Lab',
      title: 'Название',
      titlePlaceholder: 'Введите заголовок графика',
      description: 'Описание (необязательно)',
      descriptionPlaceholder: 'Введите описание',
      csvTitle: 'Импорт CSV (по желанию)',
      csvDescription:
        'Формат из примера: date,name,value. Обязательные поля: date,name,value; дата обычно в виде YYYY-MM-DD. Также можно: name,value,period. Импорт заменяет текущие данные формы.',
      chooseCsv: 'Выбрать CSV...',
      labelLayoutTitle: 'Расположение подписи на баре',
      labelLayoutHelp: 'Выберите, где показывать название и значение: в правом или левом краю бара.',
      right: 'Справа',
      rightDesc: 'Название и значение друг под другом в правом краю бара',
      left: 'Слева',
      leftDesc: 'Название и значение друг под другом в левом краю бара',
      demoDataBadge:
        'Данные ниже показаны как пример. Можно очистить всё и ввести свои, или использовать импорт выше.',
      clear: 'Очистить',
      itemsSection: '1) Названия элементов',
      itemPlaceholder: 'Например: Product A',
      add: 'Добавить',
      periodsSection: '2) Даты / периоды',
      periodPlaceholder: 'Например: 2024',
      untitled: 'Без названия',
      valuesSection: '3) Значения для периода:',
      noPeriod: 'Сначала добавьте и выберите период.',
      valuePlaceholder: 'Значение',
      startIn: 'Старт через',
      secShort: 'сек',
      seconds: 'секунд',
      animating: 'Анимация...',
      play: 'Play',
      openChart: 'Открыть график',
      close: 'Закрыть',
      startAnimation: 'Запустить анимацию',
      playDisabledTitleRequired: 'Заполните название графика, чтобы запустить Play.',
      playDisabledNeedTwoItems: 'Нужно минимум 2 элемента в графике для запуска Play.',
      errors: {
        enterItem: 'Введите название элемента.',
        duplicateItem: 'Такое название уже существует.',
        enterPeriod: 'Введите название периода.',
        duplicatePeriod: 'Такой период уже существует.',
        readFile: 'Не удалось прочитать файл.',
        addPeriod: 'Добавьте хотя бы один период.',
        addItem: 'Добавьте хотя бы одно название элемента.',
        periodNameRequired: 'У каждого периода должно быть название.',
        periodMissingItems: 'В периоде "{period}" должен быть полный список названий.',
        periodInvalidValues: 'Проверьте значения в периоде "{period}" (value >= 0).',
      },
      csvErrors: {
        emptyFile: 'Файл пуст.',
        parseFailed: 'Не удалось разобрать CSV.',
        noRows: 'Нет строк данных (кроме заголовка).',
        requiredColumns: 'Нужны колонки name и value (или аналоги: label, value).',
        dateOrPeriod: 'Нужна колонка date (YYYY-MM-DD) или period.',
        noValidRows: 'Нет ни одной валидной строки (name, value, дата/период).',
      },
    },
  },
  en: {
    language: 'Language',
    app: {
      miniApp: 'Mini App',
      openInTelegram: 'Open in Telegram',
      fallbackDescription:
        'This app works only inside Telegram. Open the bot and launch it from chat to get full access to charts and settings.',
      openBot: 'Open bot',
      fallbackHint: 'The link will open in Telegram if it is installed on your device.',
    },
    chart: {
      defaultTitle: 'Top Sales by Year',
      defaultDescription: 'Animated ranking by periods',
      settingsTitle: 'Postigator Lab Settings',
      title: 'Title',
      titlePlaceholder: 'Enter chart title',
      description: 'Description (optional)',
      descriptionPlaceholder: 'Enter description',
      csvTitle: 'CSV import (optional)',
      csvDescription:
        'Example format: date,name,value. Required fields: date,name,value; date is usually YYYY-MM-DD. Alternative format: name,value,period. Import replaces current form data.',
      chooseCsv: 'Choose CSV...',
      labelLayoutTitle: 'Bar label position',
      labelLayoutHelp: 'Choose where to show name and value: at the right or left edge of the bar.',
      right: 'Right',
      rightDesc: 'Name and value stacked at the right edge of the bar',
      left: 'Left',
      leftDesc: 'Name and value stacked at the left edge of the bar',
      demoDataBadge:
        'The data below is sample data. You can clear everything and enter your own, or use the import above.',
      clear: 'Clear',
      itemsSection: '1) Item names',
      itemPlaceholder: 'For example: Product A',
      add: 'Add',
      periodsSection: '2) Dates / periods',
      periodPlaceholder: 'For example: 2024',
      untitled: 'Untitled',
      valuesSection: '3) Values for period:',
      noPeriod: 'Add and select a period first.',
      valuePlaceholder: 'Value',
      startIn: 'Starts in',
      secShort: 'sec',
      seconds: 'seconds',
      animating: 'Animating...',
      play: 'Play',
      openChart: 'Open chart',
      close: 'Close',
      startAnimation: 'Start animation',
      playDisabledTitleRequired: 'Enter a chart title to enable Play.',
      playDisabledNeedTwoItems: 'At least 2 items are required to enable Play.',
      errors: {
        enterItem: 'Enter an item name.',
        duplicateItem: 'This item name already exists.',
        enterPeriod: 'Enter a period name.',
        duplicatePeriod: 'This period already exists.',
        readFile: 'Failed to read the file.',
        addPeriod: 'Add at least one period.',
        addItem: 'Add at least one item name.',
        periodNameRequired: 'Each period must have a name.',
        periodMissingItems: 'Period "{period}" must include all item names.',
        periodInvalidValues: 'Check values in period "{period}" (value >= 0).',
      },
      csvErrors: {
        emptyFile: 'The file is empty.',
        parseFailed: 'Failed to parse CSV.',
        noRows: 'No data rows found (header only).',
        requiredColumns: 'Columns name and value are required (or aliases: label, value).',
        dateOrPeriod: 'Column date (YYYY-MM-DD) or period is required.',
        noValidRows: 'No valid rows found (name, value, date/period).',
      },
    },
  },
} as const

export const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: 'en',
  messages,
})
