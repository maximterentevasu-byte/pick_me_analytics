# Telegram weekly channel metrics → Google Sheets

Готовый Node.js-проект для Railway.

Что делает:
- раз в неделю считает метрики за **полную прошлую неделю**;
- период всегда: **00:00 понедельника → 23:59:59 воскресенья** в выбранной тайзоне;
- получает данные из Telegram через **MTProto / GramJS**;
- пишет итоговые строки в Google Sheets.

## Почему не Bot API
Некоторые нужные тебе показатели Telegram отдаёт только через MTProto и права администратора канала:
- `stats.getBroadcastStats` — общая статистика канала;
- `enabled_notifications` — доля пользователей с включёнными уведомлениями;
- `stats.getStoryStats` и story-related stats — статистика сторис.

Поэтому проект использует **авторизацию обычного Telegram-аккаунта** администратора канала.

## Что сейчас считает
### Посты
- Дата начала недели
- Дата конца недели
- Канал
- Подписчики (на конец периода)
- Средний просмотр поста
- ER (по просмотрам) %
- ER (по активностям) %
- Ср. кол-во реакций
- **Ср. кол-во комментариев**
- Ср. кол-во репостов
- Кол-во постов
- Сумма просмотров постов
- Сумма реакций
- Сумма комментариев
- Сумма репостов
- Engagement на пост
- Реакции на 1000 просмотров
- Репосты на 1000 просмотров
- Комментариев на 1000 просмотров
- Виральность постов %
- Индекс качества контента

### Сторис
- Средний просмотр сторис
- ER сторис (по просмотрам) %
- Кол-во сторис
- Среднее кол-во реакций на сторис
- Среднее кол-во репостов сторис

### Канальная статистика
- Доля пользователей с включёнными уведомлениями %

## Как считается комментарий
В старом коде у тебя, судя по описанию, комментарии не считались корректно. Здесь комментарии считаются по полю `message.replies.replies`, то есть по размеру comment thread у поста канала.

## Важные ограничения Telegram
1. Для `stats` и части story-метрик аккаунт должен быть **админом** канала.
2. У канала должен быть доступ к Telegram Statistics (`can_view_stats`).
3. История сторис берётся через архив сторис. Для этого нужны права администратора, связанные со сторис.
4. `Индекс качества контента` не имеет официальной формулы Telegram, поэтому здесь он реализован как **настраиваемый composite score 0–100** на основе ER, реакций, комментариев, репостов и виральности. Формулу можно легко поменять в `src/metrics.js`.

## Стек
- Node.js 20+
- GramJS
- Google Sheets API
- Railway
- Luxon
- node-cron

## Установка локально
```bash
npm install
cp .env.example .env
```

## 1) Получить Telegram API ID / API HASH
Создай приложение в Telegram API development tools и забери:
- `TELEGRAM_API_ID` или `TG_API_ID`
- `TELEGRAM_API_HASH` или `TG_API_HASH`

## 2) Сгенерировать String Session
В `.env` временно задай:
```env
TG_API_ID=123456
TG_API_HASH=your_hash
```

Потом:
```bash
npm run session
```

Скрипт попросит:
- номер телефона;
- код из Telegram;
- пароль 2FA, если включён.

На выходе получишь `TELEGRAM_STRING_SESSION` или можешь сохранить это же значение в `TG_STRING_SESSION` — проект понимает оба варианта.

## 3) Подключить Google Sheets
Создай service account в Google Cloud и дай ему доступ на редактирование нужной таблицы.

Нужны:
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

## 4) ENV-переменные
Пример:
```env
TIMEZONE=Europe/Zurich
CHANNELS=@my_channel,@my_second_channel
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_TAB=Metrics
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
TG_API_ID=123456
TG_API_HASH=...
TG_STRING_SESSION=...
CRON_SCHEDULE=5 0 * * 1
APPEND_HEADERS_IF_EMPTY=true
DRY_RUN=false
```

## 5) Локальный запуск
Однократный запуск:
```bash
npm run run-once
```

Постоянный режим с cron:
```bash
npm start
```

## Логика расписания
По умолчанию cron:
```cron
5 0 * * 1
```
Это значит: каждый понедельник в **00:05** по `TIMEZONE`.

Собирается **предыдущая завершённая неделя**.

## Railway
1. Создай новый сервис из GitHub-репозитория.
2. Добавь все ENV-переменные из `.env.example`. Если у тебя уже используются старые имена `TG_*`, их можно не переименовывать — проект их поддерживает.
3. Start Command:
```bash
npm start
```
4. Railway сам поставит зависимости и будет держать сервис запущенным.

## Структура проекта
```text
src/
  config.js
  index.js
  metrics.js
  sheets.js
  telegram.js
  utils.js
scripts/
  generate-session.js
```

## Что можно докрутить дальше
Если захочешь следующий апгрейд, логично добавить:
- дедупликацию строк по `канал + дата начала недели + дата конца недели`;
- отдельный лист `raw_posts` и `raw_stories`;
- backfill за прошлые недели;
- retry / alerting в Telegram или Slack;
- более строгий расчёт story views/reactions через разбор async-графов Telegram статистики.
