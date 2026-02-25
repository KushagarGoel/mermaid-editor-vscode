import * as vscode from 'vscode';
import { MermaidPreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "FunWithMermaid" is now active!');

	const disposable = vscode.commands.registerCommand('FunWithMermaid.preview', () => {
		MermaidPreviewPanel.createOrShow(context.extensionUri);

		// Send initial content
		if (vscode.window.activeTextEditor) {
			if (MermaidPreviewPanel.currentPanel) {
				MermaidPreviewPanel.currentPanel.currentDocumentUri = vscode.window.activeTextEditor.document.uri;
				MermaidPreviewPanel.currentPanel.updateContent(vscode.window.activeTextEditor.document.getText());
			}
		}
	});

	context.subscriptions.push(disposable);

	// Listen for text document changes to update the preview
	vscode.workspace.onDidChangeTextDocument(event => {
		if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
			if (event.document.languageId === 'mermaid' || event.document.fileName.endsWith('.mmd') || event.document.fileName.endsWith('.mermaid')) {
				if (MermaidPreviewPanel.currentPanel) {
					MermaidPreviewPanel.currentPanel.currentDocumentUri = event.document.uri;
					MermaidPreviewPanel.currentPanel.updateContent(event.document.getText());
				}
			}
		}
	}, null, context.subscriptions);

	// Listen for active editor changes
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && (editor.document.languageId === 'mermaid' || editor.document.fileName.endsWith('.mmd') || editor.document.fileName.endsWith('.mermaid'))) {
			if (MermaidPreviewPanel.currentPanel) {
				MermaidPreviewPanel.currentPanel.currentDocumentUri = editor.document.uri;
				MermaidPreviewPanel.currentPanel.updateContent(editor.document.getText());
			}
		}
	}, null, context.subscriptions);
}

export function deactivate() { }
