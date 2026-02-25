(function () {
    const vscode = acquireVsCodeApi();

    const diagramContainer = document.getElementById('diagram-container');
    const errorContainer = document.getElementById('error-container');
    const previewPane = document.querySelector('.preview-pane');
    const zoomSelect = document.getElementById('zoom-select');
    let currentScale = 3; // Default 300%

    document.getElementById('btn-zoom-in').addEventListener('click', () => {
        currentScale += 0.2;
        updateZoom();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
        currentScale = Math.max(0.2, currentScale - 0.2);
        updateZoom();
    });

    zoomSelect.addEventListener('change', (e) => {
        currentScale = parseFloat(e.target.value);
        updateZoom();
    });

    // Handle Trackpad Pinch-to-Zoom
    previewPane.addEventListener('wheel', (e) => {
        // Checking for ctrlKey or metaKey indicates a pinch/zoom gesture on trackpads or ctrl+scroll
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); // Stop the default page scale

            // Adjust the scaling factor. deltaY indicates scroll amount.
            // Increased multiplier from 0.005 to 0.015 for faster zooming
            const zoomDelta = e.deltaY * -0.015;

            // Apply scale, lock to a minimum to avoid inverting
            currentScale = Math.max(0.1, currentScale + zoomDelta);
            updateZoom();
        }
    }, { passive: false }); // Requires passive: false to allow e.preventDefault()



    function updateZoom() {
        // Sync the dropdown UI to nearest integer if it dynamically zoomed
        let roundedValue = Math.round(currentScale);
        if (roundedValue < 1) roundedValue = 1;
        if (roundedValue > 7) roundedValue = 7;

        // Only update UI if the option actually exists to avoid blanking
        const optionExists = Array.from(zoomSelect.options).some(opt => parseInt(opt.value) === roundedValue);
        if (optionExists) {
            zoomSelect.value = roundedValue.toString();
        }

        const svg = document.querySelector('#mermaid-svg');
        if (svg) {
            svg.style.maxWidth = 'none';
            // Use width to appropriately scale the SVG
            svg.style.width = (currentScale * 100) + '%';
            svg.style.minWidth = (currentScale * 100) + '%';
            svg.style.height = 'auto';
        }
    }

    // Pan (Drag) logic
    let isDragging = false;
    let startX, startY, scrollLeft, scrollTop;

    // Helper for finding parent nodes in SVGs
    function getClosestNode(element) {
        let current = element;
        while (current && current !== document) {
            let cls = current.getAttribute ? current.getAttribute('class') : '';
            if (cls && (cls.includes('node') || cls.includes('actor') || cls.includes('classGroup') || cls.includes('state') || cls.includes('label'))) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    previewPane.addEventListener('mousedown', (e) => {
        // Only pan if we aren't clicking an input or button
        if (e.target.tagName && (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'button')) {
            return;
        }

        // Don't drag if we are clicking a node (to allow for double click edits)
        if (getClosestNode(e.target)) {
            return;
        }

        isDragging = true;
        previewPane.style.cursor = 'grabbing';

        startX = e.pageX - previewPane.offsetLeft;
        startY = e.pageY - previewPane.offsetTop;
        scrollLeft = previewPane.scrollLeft;
        scrollTop = previewPane.scrollTop;
    });

    // Attach to window so we don't lose it if mouse leaves pane
    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            previewPane.style.cursor = 'grab';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - previewPane.offsetLeft;
        const y = e.pageY - previewPane.offsetTop;
        const walkX = (x - startX);
        const walkY = (y - startY);
        previewPane.scrollLeft = scrollLeft - walkX;
        previewPane.scrollTop = scrollTop - walkY;
    });

    // Make the initial cursor style grab
    previewPane.style.cursor = 'grab';

    // Initialize mermaid
    mermaid.initialize({
        startOnLoad: false,
        theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark'
    });

    // Handle messages sent from the extension to the webview
    // We store the active code secretly so inline edits can dispatch updates
    let activeSourceCode = "";

    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'update':
                activeSourceCode = message.text;
                renderDiagramOnly(message.text);
                break;
        }
    });

    async function renderDiagramOnly(text) {
        if (!text || text.trim() === '') {
            diagramContainer.innerHTML = '';
            errorContainer.style.display = 'none';
            return;
        }

        try {
            // Check if syntax is valid
            const isValid = await mermaid.parse(text, { suppressErrors: true });

            if (isValid) {
                // Save current scroll positions
                const previousScrollLeft = previewPane.scrollLeft;
                const previousScrollTop = previewPane.scrollTop;

                // Render the diagram
                const { svg } = await mermaid.render('mermaid-svg', text);
                diagramContainer.innerHTML = svg;
                errorContainer.style.display = 'none';
                updateZoom(); // Re-apply zoom to the new SVG

                attachNodeEditListeners();

                // Restore scroll positions
                previewPane.scrollLeft = previousScrollLeft;
                previewPane.scrollTop = previousScrollTop;
            }
        } catch (err) {
            // Parse failed, show error
            errorContainer.textContent = err.message || err.str || String(err);
            errorContainer.style.display = 'block';
        }
    }

    // Inline Editing Logic
    let activeInputBox = null;

    function attachNodeEditListeners() {
        const svg = document.querySelector('#mermaid-svg');
        if (!svg) return;

        // Mermaid node classes: node, label, etc.
        // Flowchart node groups usually have class="node" and an ID that matches the node ID
        const nodes = svg.querySelectorAll('.node');

        nodes.forEach(node => {
            node.style.cursor = 'text';
        });

        // Use event delegation on the SVG instead of attaching to individual nodes
        // because Mermaid rerenders often, wiping node listeners.
        svg.addEventListener('dblclick', (e) => {
            const node = getClosestNode(e.target);
            if (!node) return;

            e.stopPropagation();

            // If there's already an active input, finish editing that one first
            if (activeInputBox) {
                finishInlineEdit(activeInputBox);
            }

            // Node ID is usually something like 'flowchart-A-123' or just 'A'
            // We map this back to the node's original text inside the sourceEditor
            const nodeId = node.id;

            // Get the text content of the node (handles SVG text and HTML labels in foreignObjects)
            let currentText = node.textContent;
            if (!currentText) return;
            currentText = currentText.trim().replace(/\s+/g, ' ');

            if (currentText.length === 0) return;

            // We need to create an absolute positioned text input over the node
            const nodeBBox = node.getBoundingClientRect();
            const containerBBox = previewPane.getBoundingClientRect();

            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.dataset.originalText = currentText;

            // Style to place it directly where the node is
            input.style.position = 'absolute';
            input.style.left = (nodeBBox.left - containerBBox.left + previewPane.scrollLeft) + 'px';
            input.style.top = (nodeBBox.top - containerBBox.top + previewPane.scrollTop) + 'px';
            input.style.width = nodeBBox.width + 'px';
            input.style.height = nodeBBox.height + 'px';
            input.style.zIndex = 1000;
            input.style.fontSize = '14px';
            input.style.textAlign = 'center';
            input.style.border = '2px solid var(--vscode-focusBorder)';
            input.style.background = 'var(--vscode-input-background)';
            input.style.color = 'var(--vscode-input-foreground)';

            previewPane.appendChild(input);
            input.focus();
            input.select();

            activeInputBox = input;

            // Handle completing the edit
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    finishInlineEdit(input);
                } else if (e.key === 'Escape') {
                    cancelInlineEdit(input);
                }
            });

            input.addEventListener('blur', () => {
                if (input.parentNode) {
                    finishInlineEdit(input);
                }
            });
        });
    }

    function finishInlineEdit(input) {
        if (!input || !input.parentNode) return;
        const newText = input.value;
        const oldText = input.dataset.originalText;

        input.parentNode.removeChild(input);
        activeInputBox = null;

        if (newText && newText !== oldText) {
            // Find the old text in the source code and replace it
            // Note: This is a basic string replace, which assumes the label text exactly matches the syntax text.
            let code = activeSourceCode;

            // Simple replacement
            if (code.includes(oldText)) {
                code = code.replace(oldText, newText);
                activeSourceCode = code;

                // Send change to VS Code directly
                vscode.postMessage({
                    command: 'edit',
                    text: code
                });

                // Optinally rerender immediately for instant feedback
                renderDiagramOnly(code);
            }
        }
    }

    function cancelInlineEdit(input) {
        if (!input || !input.parentNode) return;
        input.parentNode.removeChild(input);
        activeInputBox = null;
    }
}());
