# Qwen AI Chat

ИИ-чат ассистент с поддержкой локальной работы на устройстве (WebGPU) и серверного режима (Ollama).

## Быстрый старт

### 1. Установи VS Code
Скачай: https://code.visualstudio.com/

Установи расширения:
- **Live Server** — для локального просмотра в браузере
- **GitHub Pull Requests** — для работы с GitHub

### 2. Создай GitHub аккаунт
https://github.com → Sign up

### 3. Создай репозиторий
1. Нажми **+** → **New repository**
2. Назови: `qwen-chat`
3. Поставь галку **Public**
4. Нажми **Create repository**

### 4. Загрузи файлы
В VS Code:
1. Открой папку проекта: `File → Open Folder`
2. Открой терминал: `` Ctrl + ` ``
3. Выполни:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/ТВОЙ_ЛОГИН/qwen-chat.git
git branch -M main
git push -u origin main
```

### 5. Включи GitHub Pages
1. Иди в настройки репозитория: **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** / **(root)**
4. Нажми **Save**
5. Через 1-2 минуты сайт будет доступен: `https://ТВОЙ_ЛОГИН.github.io/qwen-chat/`

### 6. Просмотр изменений локально
В VS Code правый клик на `index.html` → **Open with Live Server**
Браузер откроется автоматически. Любые изменения в коде отображаются мгновенно.

### 7. Публикация изменений
```bash
git add .
git commit -m "описание изменений"
git push
```
GitHub Pages обновится автоматически через ~30 секунд.

## Структура проекта

```
qwen-chat/
├── index.html          ← Главная страница
├── assets/
│   ├── chat.css        ← Стили
│   └── chat.js         ← Логика чата
├── .nojekyll           ← Отключает Jekyll (нужно для GitHub Pages)
└── README.md           ← Этот файл
```

## Настройка сервера (n8n)

Если используешь серверный режим, измени URL в `assets/chat.js`:
```js
const TOOLS_URL = 'https://ВАШ_СЕРВЕР/webhook/tools';
const CHAT_URL = 'https://ВАШ_СЕРВЕР/webhook/my-custom-chat';
```

## Свой домен

1. Купи домен (Namecheap, Porkbun, и т.д.)
2. В настройках домена создай CNAME запись: `ТВОЙ_ЛОГИН.github.io`
3. В GitHub Settings → Pages → Custom domain: `твой-домен.com`
4. Поставь галку **Enforce HTTPS**
