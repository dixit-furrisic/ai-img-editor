// use-undoredo-hook.jsx
import { useCallback, useState, useEffect } from "react";

const TRACKABLE_ACTIONS = {
    OBJECT_MODIFIED: 'object:modified',
    OBJECT_ADDED: 'object:added',
    OBJECT_REMOVED: 'object:removed',
    BACKGROUND_REMOVED: 'background:removed',
    IMAGE_CROPPED: 'image:cropped',
    CANVAS_RESIZED: 'canvas:resized',
    CANVAS_BACKGROUND_CHANGED: 'canvas:background:changed',
    FILTER_APPLIED: 'filter:applied',
    TEXT_ADDED: 'text:added',
    SHAPE_ADDED: 'shape:added',
    IMAGE_REPLACED: 'image:replaced',
    BULK_OPERATION: 'bulk:operation'
};

const IGNORED_ACTIONS = {
    SELECTION_CREATED: 'selection:created',
    SELECTION_UPDATED: 'selection:updated',
    SELECTION_CLEARED: 'selection:cleared',
    MOUSE_MOVE: 'mouse:move',
    MOUSE_OVER: 'mouse:over',
    MOUSE_OUT: 'mouse:out',
    OBJECT_MOVING: 'object:moving',
    OBJECT_SCALING: 'object:scaling',
    OBJECT_ROTATING: 'object:rotating'
};

export const useCanvasUndoRedo = (canvasEditor) => {
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [isUndoRedoOperation, setIsUndoRedoOperation] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [lastSavedHash, setLastSavedHash] = useState(null);

    const MAX_UNDO_STACK_SIZE = 50;
    const DEBOUNCE_DELAY = 1000;

    const generateStateHash = useCallback((canvasState) => {
        return JSON.stringify(canvasState).length + '_' +
            JSON.stringify(canvasState).slice(0, 100);
    }, []);

    const getCleanCanvasState = useCallback(() => {
        if (!canvasEditor) return null;

        try {
            const state = canvasEditor.toJSON([
                'id', 'selectable', 'evented', 'left', 'top', 'scaleX', 'scaleY',
                'angle', 'flipX', 'flipY', 'opacity', 'width', 'height', 'fill',
                'stroke', 'strokeWidth', 'src', 'filters', 'clipPath', 'text',
                'fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'lineHeight'
            ]);

            state.canvasWidth = canvasEditor.getWidth();
            state.canvasHeight = canvasEditor.getHeight();
            state.backgroundColor = canvasEditor.backgroundColor;
            state.backgroundImage = canvasEditor.backgroundImage;

            return state;
        } catch (error) {
            console.error('Error getting canvas state:', error);
            return null;
        }
    }, [canvasEditor]);

    const saveToUndoStack = useCallback((actionType = 'unknown', metadata = {}) => {
        if (!canvasEditor || isUndoRedoOperation) {

            return;
        }

        const currentState = getCleanCanvasState();
        if (!currentState) {
            console.warn('⚠️ No valid canvas state to save');
            return;
        }

        const currentHash = generateStateHash(currentState);

        if (lastSavedHash === currentHash) {
            return;
        }

        const stateWithMetadata = {
            state: currentState,
            timestamp: Date.now(),
            actionType,
            metadata,
            hash: currentHash
        };

        setUndoStack(prev => {
            const newStack = [...prev, stateWithMetadata];
            if (newStack.length > MAX_UNDO_STACK_SIZE) {
                newStack.shift();
            }

            return newStack;
        });

        setRedoStack([]);
        setLastSavedHash(currentHash);
    }, [canvasEditor, isUndoRedoOperation, getCleanCanvasState, generateStateHash, lastSavedHash]);


    // useEffect(() => {
    //     if (!canvasEditor || isInitialized) return;

    //     const initialState = getCleanCanvasState();
    //     if (initialState) {
    //         const initialStateWithMetadata = {
    //             state: initialState,
    //             timestamp: Date.now(),
    //             actionType: 'initial_state',
    //             metadata: { isInitial: true },
    //             hash: generateStateHash(initialState)
    //         };

    //         setUndoStack([initialStateWithMetadata]);
    //         setLastSavedHash(initialStateWithMetadata.hash);
    //         setIsInitialized(true);
    //         console.log('Undo system initialized');
    //     }
    // }, [canvasEditor, isInitialized, getCleanCanvasState, generateStateHash]);

    // useEffect(() => {
    //     if (!canvasEditor || !isInitialized) return;

    //     const handleObjectModified = (e) => {
    //         const obj = e.target;
    //         saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_MODIFIED, {
    //             objectType: obj?.type,
    //             objectId: obj?.id
    //         });
    //     };

    //     const handleObjectAdded = (e) => {
    //         const obj = e.target;
    //         saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_ADDED, {
    //             objectType: obj?.type,
    //             objectId: obj?.id
    //         });
    //     };

    //     const handleObjectRemoved = (e) => {
    //         const obj = e.target;
    //         saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_REMOVED, {
    //             objectType: obj?.type,
    //             objectId: obj?.id
    //         });
    //     };

    //     const handlePathCreated = (e) => {
    //         saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_ADDED, {
    //             objectType: 'path',
    //             isDrawing: true
    //         });
    //     };

    //     canvasEditor.on('object:modified', handleObjectModified);
    //     canvasEditor.on('object:added', handleObjectAdded);
    //     canvasEditor.on('object:removed', handleObjectRemoved);
    //     canvasEditor.on('path:created', handlePathCreated);

    //     return () => {
    //         canvasEditor.off('object:modified', handleObjectModified);
    //         canvasEditor.off('object:added', handleObjectAdded);
    //         canvasEditor.off('object:removed', handleObjectRemoved);
    //         canvasEditor.off('path:created', handlePathCreated);
    //     };
    // }, [canvasEditor, isInitialized, saveToUndoStack]);

    const handleUndo = useCallback(async () => {
        console.group('Undo Operation');

        if (!canvasEditor || undoStack.length <= 1) {

            console.groupEnd();
            return false;
        }

        setIsUndoRedoOperation(true);

        try {
            // Save current state to redo stack
            const currentState = getCleanCanvasState();
            if (currentState) {
                setRedoStack(prev => [...prev, {
                    state: currentState,
                    timestamp: Date.now(),
                    actionType: 'redo_point',
                    metadata: {},
                    hash: generateStateHash(currentState)
                }]);
            }

            // Get previous state
            setUndoStack(prev => {
                const newStack = [...prev];
                const removedState = newStack.pop();
                return newStack;
            });

            const previousStateData = undoStack[undoStack.length - 2];

            if (previousStateData?.state) {
                await canvasEditor.loadFromJSON(previousStateData.state);

                if (previousStateData.state.canvasWidth && previousStateData.state.canvasHeight) {
                    canvasEditor.setDimensions({
                        width: previousStateData.state.canvasWidth,
                        height: previousStateData.state.canvasHeight
                    });
                }

                if (previousStateData.state.backgroundColor) {
                    canvasEditor.setBackgroundColor(previousStateData.state.backgroundColor);
                }

                canvasEditor.requestRenderAll();
                setLastSavedHash(previousStateData.hash);

                console.groupEnd();
                return true;
            } else {
                canvasEditor.clear();
                canvasEditor.requestRenderAll();
                setLastSavedHash(null);

                console.groupEnd();
                return true;
            }
        } catch (error) {
            console.error('Error during undo:', error);
            return false;
        } finally {
            setIsUndoRedoOperation(false);
        }
    }, [canvasEditor, undoStack, getCleanCanvasState, generateStateHash]);




    const handleRedo = useCallback(async () => {
        if (!canvasEditor || redoStack.length === 0) {
            return false;
        }

        setIsUndoRedoOperation(true);

        try {
            // Save current state to undo stack
            const currentState = getCleanCanvasState();
            if (currentState) {
                setUndoStack(prev => [...prev, {
                    state: currentState,
                    timestamp: Date.now(),
                    actionType: 'undo_point',
                    metadata: {},
                    hash: generateStateHash(currentState)
                }]);
            }

            // Get next state from redo stack
            setRedoStack(prev => {
                const newStack = [...prev];
                const nextStateData = newStack.pop();

                if (nextStateData?.state) {
                    (async () => {
                        await canvasEditor.loadFromJSON(nextStateData.state);

                        if (nextStateData.state.canvasWidth && nextStateData.state.canvasHeight) {
                            canvasEditor.setDimensions({
                                width: nextStateData.state.canvasWidth,
                                height: nextStateData.state.canvasHeight
                            });
                        }

                        if (nextStateData.state.backgroundColor) {
                            canvasEditor.setBackgroundColor(nextStateData.state.backgroundColor);
                        }

                        canvasEditor.requestRenderAll();
                        setLastSavedHash(nextStateData.hash);
                    })();
                }

                return newStack;
            });

            return true;
        } catch (error) {
            console.error('Error during redo:', error);
            return false;
        } finally {
            setIsUndoRedoOperation(false);
        }
    }, [canvasEditor, redoStack, getCleanCanvasState, generateStateHash]);

    const clearHistory = useCallback(() => {
        setUndoStack([]);
        setRedoStack([]);
        setLastSavedHash(null);
        setIsInitialized(false);
    }, []);

    const getHistoryInfo = useCallback(() => {
        return {
            canUndo: undoStack.length > 1,
            canRedo: redoStack.length > 0,
            undoCount: Math.max(0, undoStack.length - 1),
            redoCount: redoStack.length,
            lastAction: undoStack.length > 0 ? undoStack[undoStack.length - 1]?.actionType : null
        };
    }, [undoStack, redoStack]);

    return {
        handleUndo,
        handleRedo,
        saveUndoState,
        clearHistory,
        getHistoryInfo,
        saveToUndoStack,
        isUndoRedoOperation,
        TRACKABLE_ACTIONS,
    };
};