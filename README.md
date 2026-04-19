# Telegram Weekly Stats

Сервис на Node.js для еженедельного сбора статистики по Telegram-каналам:
- подписчики
- средние просмотры постов
- ER по просмотрам
- ER по активностям
- среднее число реакций
- среднее число комментариев
- среднее число репостов
- число постов
- средние просмотры сториз
- число сториз
- доля пользователей с включёнными уведомлениями

Результат пишется:
1. в Google Sheets
2. в локальный `.xlsx` как резервная копия

## Важно

Для полной статистики используется **MTProto** через пользовательскую сессию Telegram, а не Bot API.

## Быстрый старт

### 1. Установка

```bash
npm install
```

### 2. Заполни `.env`

Скопируй пример:

```bash
cp .env.example .env
```

И заполни значения.

### 3. Получи `TG_STRING_SESSION`

```bash
npm run session
```

После запуска вставь полученную строку в `.env`:

```env
TG_STRING_SESSION=...
```

### 4. Запусти сбор отчёта

```bash
npm run report
```

## Переменные окружения

### Telegram
- `TG_API_ID`
- `TG_API_HASH`
- `TG_STRING_SESSION`
- `TG_PHONE`
- `CHANNELS`

### Google Sheets
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

### Прочее
- `OUTPUT_XLSX`
- `TIMEZONE`

## Структура листа

Создаётся лист `weekly_stats` со столбцами:

- `week_start`
- `week_end`
- `channel`
- `subscribers`
- `avg_reach_post`
- `avg_views_post`
- `post_er_views_pct`
- `post_er_activities_pct`
- `avg_reactions_post`
- `avg_comments_post`
- `avg_reposts_post`
- `posts_count`
- `avg_reach_story`
- `avg_views_story`
- `story_er_views_pct`
- `story_er_activities_pct`
- `stories_count`
- `enabled_notifications_pct`

## Railway

### Deploy
1. Залей проект в GitHub
2. Подключи репозиторий к Railway
3. Добавь переменные окружения из `.env`
4. Для ручного запуска используй команду:

```bash
npm run report
```

### Cron в Railway
Создай scheduled job на понедельник утром.
Например:
- Cron: `0 8 * * 1`
- Command: `npm run report`

## Примечания

- Для части каналов Telegram отдаёт статистику только если у канала доступна встроенная статистика.
- Если статистика канала недоступна, скрипт пропустит такой канал и выведет ошибку в лог.
- Для комментариев нужен подключённый discussion group.
