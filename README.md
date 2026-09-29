# CCA Message AI — corrector de mensajes para WhatsApp Web con IA local

Creado y mantenido por [**CCA Soluciones Web**](https://ccasolucionesweb.com/). [Código en GitHub](https://github.com/TexvnOnline/cca-message-ai).

Extensión **gratis y de código abierto para Google Chrome** que permite **corregir la ortografía** y **mejorar la redacción** de un borrador en WhatsApp Web. Usa un modelo GGUF mediante [llama.cpp](https://github.com/ggml-org/llama.cpp) en tu propio equipo. Puedes revisar y editar el resultado antes de enviarlo.

No necesitas una cuenta de IA ni una clave API. La extensión no incluye el servidor ni el modelo: cada usuario los instala por separado. Este proyecto es independiente de WhatsApp y Meta.

## Qué hace

- Añade **✓ Corregir** y **✨ Mejorar** al editor de mensajes de WhatsApp Web, incluido el campo de descripción de archivos.
- Sustituye el borrador con la respuesta de la IA local, sin pulsar **Enviar** por ti.
- Detecta automáticamente el modelo cargado en `llama-server`.
- Se comunica únicamente con `http://127.0.0.1:8080`; el borrador enviado para procesar llega al servidor que ejecutas en tu equipo.

## Instalación rápida en Windows

Necesitas **Google Chrome**, [llama.cpp para Windows](https://github.com/ggml-org/llama.cpp/releases) y un modelo GGUF. **Node.js con npm** solo es necesario si quieres compilar o modificar el código. Recomendamos [Qwen2.5 3B Instruct GGUF](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/tree/main), en la variante `q4_k_m`. La descarga del modelo ronda los 2 GB; reserva también varios GB de RAM para ejecutarlo. Revisa la licencia del modelo en su página antes de usarlo.

### 1. Obtén la extensión

**Sin compilar:** descarga [`cca-message-ai-chrome.zip`](https://github.com/TexvnOnline/cca-message-ai/raw/refs/heads/master/cca-message-ai-chrome.zip) y descomprímelo. En la carpeta extraída debe quedar `manifest.json`. Conserva la carpeta: Chrome la necesita para mantener instalada la extensión.

**Para modificar el código:** descarga el proyecto con **Code → Download ZIP** en GitHub y descomprímelo. Si ya usas Git, puedes clonarlo desde el botón **Code**. Abre PowerShell en la carpeta del proyecto y ejecuta:

```powershell
npm ci
npm run build:release:chrome
```

La compilación crea `dist/cca-message-ai`. Chrome debe cargar **la carpeta extraída del ZIP** o **`dist/cca-message-ai`**, según la opción elegida; no selecciones un archivo ZIP en «Cargar extensión sin empaquetar».

### 2. Inicia la IA local

Descomprime llama.cpp y descarga el archivo `.gguf` del modelo. En PowerShell, cambia las rutas de este ejemplo por las tuyas:

```powershell
& "C:\ruta\a\llama.cpp\llama-server.exe" -m "C:\ruta\a\qwen2.5-3b-instruct-q4_k_m.gguf" --host 127.0.0.1 --port 8080 -c 2048
```

Deja esa ventana abierta mientras uses la extensión. Comprueba que [http://127.0.0.1:8080/health](http://127.0.0.1:8080/health) responda con `{"status":"ok"}`. La primera carga puede tardar.

**Opción con los scripts del proyecto:** si colocas `llama-server.exe` y sus DLL en `local-ai/bin/` y renombras el GGUF como `local-ai/qwen2.5-3b.gguf`, puedes iniciarlo con:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-local-ai.ps1"
```

Para detener esa instancia y liberar memoria:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\stop-local-ai.ps1"
```

`local-ai/` se ignora en Git y no forma parte del ZIP de la extensión.

### 3. Instala la extensión en Chrome

1. Abre `chrome://extensions/`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar extensión sin empaquetar** y elige la carpeta que contiene `manifest.json`: la que extrajiste del ZIP o `dist/cca-message-ai`.
4. Abre el icono de **CCA Message AI** y pulsa **Comprobar conexión**. Debe mostrar que la IA local está lista. **Probar modelo** comprueba la generación con un ejemplo.
5. Abre [WhatsApp Web](https://web.whatsapp.com/), escribe un borrador y pulsa **Corregir** o **Mejorar**. Revisa el resultado antes de enviarlo.

Si cambias el código, ejecuta otra vez `npm run build:release:chrome`, pulsa **Recargar** en `chrome://extensions/` y actualiza WhatsApp Web. Las instalaciones manuales no se actualizan automáticamente desde GitHub.

## Solución de problemas

| Problema | Qué comprobar |
| --- | --- |
| «No se encontró el servidor de IA local» | Inicia `llama-server` y verifica `http://127.0.0.1:8080/health`. Debe usar el puerto **8080**. |
| El servidor responde, pero la extensión no genera texto | Espera a que el modelo termine de cargar, abre el popup y pulsa **Comprobar conexión** y **Probar modelo**. |
| No aparecen los botones | Recarga la extensión y después actualiza la pestaña de WhatsApp Web. |
| La IA tarda demasiado o Windows se queda sin memoria | Usa un GGUF cuantizado más pequeño y cierra otras aplicaciones; el consumo depende del modelo y del contexto. |
| Chrome no encuentra la extensión | Selecciona la carpeta que contiene `manifest.json`: la extraída del ZIP o **`dist/cca-message-ai`**. |

Si el problema continúa, abre un *issue* en el repositorio e incluye los pasos para reproducirlo, la versión de Chrome y la salida de `llama-server`. Oculta números de teléfono y mensajes privados antes de adjuntar capturas o registros.

## Desarrollo y contribuciones

¡Se aceptan correcciones, mejoras de interfaz, traducciones y documentación! También puedes crear una **rama propia** o un **fork** para probar tus cambios sin afectar la rama principal.

1. En GitHub, pulsa **Fork** para crear una copia en tu cuenta.
2. Clona **tu fork** usando la URL que muestra su botón **Code**.
3. Crea una rama para tu cambio:

   ```bash
   git switch -c mejora/mi-cambio
   npm ci
   ```

4. Haz el cambio y compruébalo:

   ```bash
   npm test
   npm run lint
   npm run build:release:chrome
   ```

5. Sube la rama y abre un **Pull Request** hacia este repositorio. Explica qué cambiaste, cómo lo probaste y adjunta una captura si modificaste la interfaz:

   ```bash
   git add .
   git commit -m "Describe tu cambio"
   git push -u origin mejora/mi-cambio
   ```

Para cambios grandes, abre primero un *issue* y comenta la idea. Las aportaciones deben respetar la licencia del proyecto y no incluir modelos GGUF, ejecutables de llama.cpp, datos personales ni claves.

## Estructura del proyecto

- `content/`: integración y botones en WhatsApp Web.
- `background/`: coordinación de solicitudes de la extensión.
- `services/llama-client.js`: comunicación con el servidor local.
- `popup/`: estado de conexión y prueba del modelo.
- `scripts/`: compilación y scripts opcionales de inicio y detención.
- `tests/`: pruebas automatizadas.

## Créditos

Proyecto creado y mantenido por [**CCA Soluciones Web**](https://ccasolucionesweb.com/). Las contribuciones de la comunidad son bienvenidas.

## Licencia

El código se distribuye bajo la licencia [BSD 3-Clause](LICENSE). Conserva todos los avisos de copyright de ese archivo al redistribuir el código. llama.cpp y el modelo Qwen tienen sus propias licencias y se descargan por separado.
