import * as vscode from 'vscode';

export class MermaidPreviewPanel {
    public static currentPanel: MermaidPreviewPanel | undefined;

    public static readonly viewType = 'mermaidPreview';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    public currentDocumentUri: vscode.Uri | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (MermaidPreviewPanel.currentPanel) {
            MermaidPreviewPanel.currentPanel._panel.reveal(column ? column + 1 : vscode.ViewColumn.Beside);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            MermaidPreviewPanel.viewType,
            'Mermaid Preview',
            column ? column + 1 : vscode.ViewColumn.Beside,
            {
                // Enable javascript in the webview
                enableScripts: true,
                // And restrict the webview to only loading content from our extension's `media` directory.
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        MermaidPreviewPanel.currentPanel = new MermaidPreviewPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for messages from the webview
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'edit':
                    this._updateDocument(message.text);
                    return;
            }
        }, null, this._disposables);
    }

    private async _updateDocument(text: string) {
        if (!this.currentDocumentUri) return;

        // Find the open document
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === this.currentDocumentUri!.toString());
        if (document) {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, text);
            await vscode.workspace.applyEdit(edit);
        }
    }

    public updateContent(text: string) {
        // Send a message to the webview to update the diagram
        this._panel.webview.postMessage({ command: 'update', text });
    }

    public dispose() {
        MermaidPreviewPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script and mermaid.js run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        const mermaidPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'mermaid.min.js');
        const mermaidUri = webview.asWebviewUri(mermaidPathOnDisk);

        // Use a nonce to securely allow only specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading images from https or from our extension directory,
                    and only allow scripts that have a specific nonce.
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src * data:; script-src 'nonce-${nonce}' 'unsafe-eval';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Mermaid Preview</title>
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        overflow: hidden;
                    }
                    .toolbar {
                        padding: 10px 16px;
                        background: var(--vscode-editorGroupHeader-tabsBackground);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    }
                    .toolbar button {
                        appearance: none;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: 1px solid var(--vscode-button-border, transparent);
                        padding: 6px 14px;
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                        font-weight: 500;
                        cursor: pointer;
                        border-radius: 4px;
                        transition: background 0.15s ease, transform 0.1s ease;
                    }
                    .toolbar button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                    .toolbar button:active {
                        transform: scale(0.97);
                    }
                    .toolbar select {
                        appearance: none;
                        background: var(--vscode-dropdown-background);
                        color: var(--vscode-dropdown-foreground);
                        border: 1px solid var(--vscode-dropdown-border);
                        padding: 5px 28px 5px 10px;
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                        border-radius: 4px;
                        cursor: pointer;
                        /* SVG chevron for dropdown */
                        background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="%236b717d" d="M12.5 5.5l-4.5 4-4.5-4z"/></svg>');
                        background-repeat: no-repeat;
                        background-position: right 6px center;
                        background-size: 14px;
                    }
                    .toolbar select:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }
                    .content-wrapper {
                        display: flex;
                        flex: 1;
                        overflow: hidden;
                    }
                    .preview-pane {
                        flex: 1;
                        overflow: auto;
                        position: relative;
                        padding: 20px;
                        text-align: center;
                    }
                    #error-container {
                        color: var(--vscode-errorForeground);
                        margin-top: 20px;
                        font-family: var(--vscode-editor-font-family);
                        white-space: pre-wrap;
                        display: none;
                    }
                    .mermaid {
                        display: inline-block;
                    }
                </style>
            </head>
            <body>
                <div class="toolbar">
                    <button id="btn-zoom-in">Zoom In (+)</button>
                    <select id="zoom-select">
                        <option value="1">100%</option>
                        <option value="2">200%</option>
                        <option value="3" selected>300%</option>
                        <option value="4">400%</option>
                        <option value="5">500%</option>
                        <option value="6">600%</option>
                        <option value="7">700%</option>
                    </select>
                    <button id="btn-zoom-out">Zoom Out (-)</button>
                </div>
                <div class="content-wrapper">
                    <div class="preview-pane">
                        <div id="diagram-container" class="mermaid"></div>
                        <div id="error-container"></div>
                    </div>
                </div>
                
                <script nonce="${nonce}" src="${mermaidUri}"></script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
