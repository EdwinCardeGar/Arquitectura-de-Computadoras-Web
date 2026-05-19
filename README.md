# Arquitectura-de-Computadoras-Web

Página web del proyecto y apuntes de clase.

Descripción

Versión mejorada con búsqueda y exportación completa (ZIP).

Cómo probar
- Abrir `index.html` en el navegador.
- Usa el campo de búsqueda para filtrar por título, contenido o nombre de archivo.
- Exportar (JSON): guarda solo metadatos.
- Exportar completo (ZIP): descarga un ZIP con `metadata.json`, la carpeta `notes/` (cada nota como JSON) y `slides/` con los archivos binarios subidos.

Funciones relevantes
- Notificaciones visuales (toasts) para confirmar acciones.
- Historial de deshacer múltiple: puedes deshacer varias acciones (borrado/edición) con el botón `Deshacer`.

Historial y export
- Panel de `Historial de Acciones` con lista de acciones recientes.
- `Exportar historial (JSON)` descarga el historial de acciones como JSON.

Recomendación
- Incluir la página en un repositorio y habilitar GitHub Pages para compartir.
- Si no puedes conectarte a CDN, descarga JSZip y colócalo como `jszip.min.js` y actualiza la etiqueta `<script>` en `index.html`.

Despliegue en GitHub Pages (resumen)
1. Crea el repo en GitHub (ya proporcionaste: https://github.com/EdwinCardeGar/Arquitectura-de-Computadoras-Web).
2. Empuja desde tu carpeta local:
   ```bash
   git remote add origin https://github.com/EdwinCardeGar/Arquitectura-de-Computadoras-Web.git
   git branch -M main
   git push -u origin main
   ```
3. En GitHub: Settings → Pages → seleccionar `main` / `/ (root)` y guardar.

Una vez habilitado, GitHub mostrará la URL pública y habilitará HTTPS automáticamente.
