# Family & Friends Page

Aplicación web desarrollada con React, TypeScript y Vite para gestionar votaciones entre familiares y amigos, con seguimiento de resultados, historial y administración básica del contenido.

## Características principales

- Gestión de participantes y juegos para una votación compartida.
- Cálculo automático de resultados y ranking de Aura.
- Historial de votaciones con posibilidad de revertir cambios.
- Modal de finalización de votación y respaldo/importación de datos.
- Integración opcional con Firebase Firestore para sincronización en la nube.
- Modo de administración temporal protegido por PIN.

## Tecnologías

- React 19
- TypeScript
- Vite
- Firebase
- ESLint

## Requisitos

- Node.js 20 o superior
- pnpm

## Instalación

1. Clona este repositorio.
2. Instala las dependencias:

```bash
pnpm install
```

3. Crea un archivo `.env` en la raíz del proyecto con las variables necesarias.

## Variables de entorno

La aplicación usa las siguientes variables de entorno:

```env
VITE_FIREBASE_API_KEY=tu_api_key
VITE_FIREBASE_AUTH_DOMAIN=tu_auth_domain
VITE_FIREBASE_PROJECT_ID=tu_project_id
VITE_FIREBASE_STORAGE_BUCKET=tu_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
VITE_FIREBASE_APP_ID=tu_app_id
VITE_FIREBASE_MEASUREMENT_ID=tu_measurement_id
VITE_ADMIN_PIN=FAMILY2026
```

> Si no configurás Firebase, la app seguirá funcionando con almacenamiento local en el navegador.

## Scripts disponibles

```bash
pnpm dev
```

Inicia el servidor de desarrollo de Vite.

```bash
pnpm build
```

Genera una build lista para producción.

```bash
pnpm lint
```

Ejecuta ESLint sobre el proyecto.

## Estructura del proyecto

```text
src/
  components/     Componentes de la interfaz
  data/           Lógica y datos de votación
  services/       Firebase, control de acceso y almacenamiento
  types/          Tipos TypeScript
```

## Uso

- Abre la app en el navegador y comienza a agregar participantes y juegos.
- Para habilitar edición administrativa, accedé desde un entorno local o usá el parámetro `?admin=true` en la URL.
- En producción, el PIN de administrador se puede definir con `VITE_ADMIN_PIN`.

## Notas

Este proyecto está pensado para uso compartido en un entorno familiar o de amigos, con una experiencia simple y rápida para organizar votaciones de juegos.
