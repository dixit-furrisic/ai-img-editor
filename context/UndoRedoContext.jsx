// use-undoredo-hook.jsx
import {
    useState,
    useEffect,
    useCallback,
    useContext,
    createContext,
    useRef
} from "react";
import { useCanvas } from "./context";

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

const CanvasUndoRedoContext = createContext();

export const CanvasUndoRedoProvider = ({ children }) => {
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [isUndoRedoOperation, setIsUndoRedoOperation] = useState(false);
    const lastSavedHash = useRef(null);
    const canvasRef = useRef(null);
    const { canvasEditor } = useCanvas();



    const MAX_UNDO_STACK_SIZE = 70;
    const DEBOUNCE_DELAY = 500;
    const debounceTimeout = useRef(null);

    const setCanvas = (canvasEditor) => {
        canvasRef.current = canvasEditor;
    };

    const getCompleteCanvasState = useCallback(() => {
        if (!canvasRef.current) return null;

        try {
            const canvasJson = canvasRef.current.toJSON();
            return {
                ...canvasJson,
                canvasWidth: canvasRef.current.getWidth(),
                canvasHeight: canvasRef.current.getHeight(),
                backgroundColor: canvasRef.current.backgroundColor,
                viewportTransform: canvasRef.current.viewportTransform,
                zoom: canvasRef.current.getZoom()
            };
        } catch (error) {
            console.error('Error getting canvas state:', error);
            return null;
        }
    }, []);

    const generateStateHash = useCallback((canvasState) => {
        return JSON.stringify(canvasState).length + '_' +
            JSON.stringify(canvasState).slice(0, 100);
    }, []);

    const saveToUndoStack = useCallback((actionType = 'unknown', metadata = {}) => {
        if (!canvasRef.current || isUndoRedoOperation) return;

        // Clear any pending debounce
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        debounceTimeout.current = setTimeout(() => {
            try {
                const canvasState = JSON.stringify(canvasRef.current.toJSON());
                const currentHash = generateStateHash(canvasState);

                if (lastSavedHash.current === currentHash) return;

                const stateWithMetadata = {
                    state: canvasState,
                    timestamp: Date.now(),
                    actionType,
                    metadata,
                    hash: currentHash
                };

                setUndoStack(prev => {
                    const newStack = [...prev, stateWithMetadata];
                    if (newStack.length > MAX_UNDO_STACK_SIZE) newStack.shift();
                    return newStack;
                });

                setRedoStack([]);
                lastSavedHash.current = currentHash;
            } catch (error) {
                console.error('Error saving undo state:', error);
            }
        }, DEBOUNCE_DELAY);
    }, [isUndoRedoOperation, generateStateHash]);

    const saveUndoState = useCallback((actionType, metadata = {}) => {

        if (!canvasRef.current || isUndoRedoOperation) {

            return;
        }

        // Clear existing debounce timeout for immediate save
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }

        try {
            const canvasState = getCompleteCanvasState();
            if (!canvasState) {
                return;
            }

            const currentHash = generateStateHash(JSON.stringify(canvasState));


            // For canvas resize, we might want to force save even if hash is same
            // because dimensions might have changed while objects stayed the same
            const shouldForceSave = actionType === TRACKABLE_ACTIONS.CANVAS_RESIZED;

            if (!shouldForceSave && lastSavedHash.current === currentHash) {

                return;
            }

            const stateWithMetadata = {
                state: JSON.stringify(canvasState),
                timestamp: Date.now(),
                actionType,
                metadata: {
                    ...metadata,
                    dimensions: {
                        width: canvasState.canvasWidth,
                        height: canvasState.canvasHeight
                    }
                },
                hash: currentHash
            };

            setUndoStack(prev => {
                const newStack = [...prev, stateWithMetadata];
                if (newStack.length > MAX_UNDO_STACK_SIZE) {
                    newStack.shift();
                }

                return newStack;
            });

            setRedoStack(() => {
                return [];
            });

            lastSavedHash.current = currentHash;

        } catch (error) {
            console.error('💥 Error saving undo state:', error);
        } finally {
        }
    }, [isUndoRedoOperation, generateStateHash, getCompleteCanvasState]);

    const handleUndo = useCallback(async () => {
        console.groupCollapsed('🌀 Undo Operation');

        if (!canvasRef.current || undoStack.length <= 1 || isUndoRedoOperation) {

            console.groupEnd();
            return false;
        }

        setIsUndoRedoOperation(true);

        try {
            const currentCompleteState = getCompleteCanvasState();
            if (!currentCompleteState) throw new Error('Failed to capture current canvas state');

            const currentHash = generateStateHash(JSON.stringify(currentCompleteState));

            setRedoStack(prev => [...prev, {
                state: JSON.stringify(currentCompleteState),
                timestamp: Date.now(),
                actionType: 'redo_point',
                metadata: {
                    dimensions: {
                        width: currentCompleteState.canvasWidth,
                        height: currentCompleteState.canvasHeight
                    }
                },
                hash: currentHash
            }]);

            const previousStateData = undoStack[undoStack.length - 2];
            if (!previousStateData?.state) throw new Error('No valid previous state found');

            setUndoStack(prev => prev.slice(0, -1));
            const parsedState = JSON.parse(previousStateData.state);

            if (parsedState.canvasWidth && parsedState.canvasHeight) {
                canvasRef.current.setWidth(parsedState.canvasWidth);
                canvasRef.current.setHeight(parsedState.canvasHeight);
                canvasRef.current.setDimensions({
                    width: parsedState.canvasWidth,
                    height: parsedState.canvasHeight
                }, { backstoreOnly: false });
            }

            await new Promise((resolve, reject) => {
                canvasRef.current.loadFromJSON(parsedState, () => {
                    if (parsedState.viewportTransform) {
                        canvasRef.current.setViewportTransform(parsedState.viewportTransform);
                    }
                    if (parsedState.zoom) {
                        canvasRef.current.setZoom(parsedState.zoom);
                    }
                    canvasRef.current.calcOffset();
                    canvasRef.current.requestRenderAll();
                    resolve();
                }, reject);
            });



            return true;

        } catch (error) {
            console.error('💥 Undo failed:', error);

            return false;

        } finally {
            setIsUndoRedoOperation(false);
        }
    }, [undoStack, isUndoRedoOperation, generateStateHash, getCompleteCanvasState]);



    const handleRedo = useCallback(async () => {
        console.group('🔄 Redo Operation');

        if (!canvasRef.current || redoStack.length === 0 || isUndoRedoOperation) {
            console.groupEnd();
            return false;
        }

        setIsUndoRedoOperation(true);

        try {
            // Save current state to undo stack
            const currentCompleteState = getCompleteCanvasState();
            if (!currentCompleteState) {
                throw new Error('Failed to capture current canvas state for redo');
            }

            const currentHash = generateStateHash(JSON.stringify(currentCompleteState));

            setUndoStack(prev => [...prev, {
                state: JSON.stringify(currentCompleteState),
                timestamp: Date.now(),
                actionType: 'undo_point',
                metadata: {},
                hash: currentHash
            }]);

            // Get next state from redo stack
            const nextStateData = redoStack[redoStack.length - 1];
            setRedoStack(prev => prev.slice(0, -1));

            if (!nextStateData?.state) {
                throw new Error('No valid redo state found');
            }

            const parsedState = JSON.parse(nextStateData.state);

            // Restore dimensions first
            if (parsedState.canvasWidth && parsedState.canvasHeight) {
                canvasRef.current.setWidth(parsedState.canvasWidth);
                canvasRef.current.setHeight(parsedState.canvasHeight);
                canvasRef.current.setDimensions({
                    width: parsedState.canvasWidth,
                    height: parsedState.canvasHeight
                }, { backstoreOnly: false });
            }

            // Load objects and render
            await new Promise((resolve, reject) => {
                canvasRef.current.loadFromJSON(parsedState, () => {
                    if (parsedState.viewportTransform) {
                        canvasRef.current.setViewportTransform(parsedState.viewportTransform);
                    }
                    if (parsedState.zoom) {
                        canvasRef.current.setZoom(parsedState.zoom);
                    }

                    canvasRef.current.calcOffset();
                    canvasRef.current.requestRenderAll();
                    resolve();
                }, reject);
            });

            lastSavedHash.current = nextStateData.hash;

            console.groupEnd();
            return true;

        } catch (error) {
            console.error('💥 Error during redo:', error);
            return false;
        } finally {
            setIsUndoRedoOperation(false);
        }
    }, [redoStack, isUndoRedoOperation, generateStateHash, getCompleteCanvasState]);

    const clearHistory = useCallback(() => {
        setUndoStack([]);
        setRedoStack([]);
        lastSavedHash.current = null;
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

    // Initialize with empty state if canvas is available
    useEffect(() => {
        if (canvasRef.current && undoStack.length === 0) {
            try {
                const initialState = JSON.stringify(canvasRef.current.toJSON());
                const initialStateWithMetadata = {
                    state: initialState,
                    timestamp: Date.now(),
                    actionType: 'initial_state',
                    metadata: { isInitial: true },
                    hash: generateStateHash(initialState)
                };
                setUndoStack([initialStateWithMetadata]);
                lastSavedHash.current = initialStateWithMetadata.hash;
            } catch (error) {
                console.error('Error initializing undo stack:', error);
            }
        }
    }, [canvasRef.current, generateStateHash]);

    // Setup event listeners
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            console.warn('⚠️ Canvas not ready. Skipping undo listeners setup.');
            return;
        }

        console.group('🎯 Setting up canvas event listeners');

        const handleObjectModified = (e) => {
            const obj = e.target;

            saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_MODIFIED, {
                objectType: obj?.type,
                objectId: obj?.id
            });
        };

        const handleObjectAdded = (e) => {
            const obj = e.target;

            saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_ADDED, {
                objectType: obj?.type,
                objectId: obj?.id
            });
        };

        const handleObjectRemoved = (e) => {
            const obj = e.target;

            saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_REMOVED, {
                objectType: obj?.type,
                objectId: obj?.id
            });
        };

        const handlePathCreated = (e) => {
            saveToUndoStack(TRACKABLE_ACTIONS.OBJECT_ADDED, {
                objectType: 'path',
                isDrawing: true
            });
        };

        const handleCanvasResize = (e) => {
            saveToUndoStack(TRACKABLE_ACTIONS.CANVAS_RESIZED, {
                oldWidth: e.oldWidth,
                oldHeight: e.oldHeight,
                newWidth: e.newWidth,
                newHeight: e.newHeight
            });
        }

        // Attach listeners
        canvasEditor.on('object:modified', handleObjectModified);
        // canvasEditor.on('object:added', handleObjectAdded);
        // canvasEditor.on('object:removed', handleObjectRemoved);
        canvasEditor.on('path:created', handlePathCreated);
        canvasEditor.on('canvas:resized', handleCanvasResize)


        return () => {
            canvasEditor.off('object:modified', handleObjectModified);
            canvasEditor.off('object:added', handleObjectAdded);
            canvasEditor.off('object:removed', handleObjectRemoved);
            canvasEditor.off('path:created', handlePathCreated);
        };
    }, [canvasRef.current]);


    return (
        <CanvasUndoRedoContext.Provider
            value={{
                setCanvas,
                handleUndo,
                handleRedo,
                saveUndoState,
                clearHistory,
                getHistoryInfo,
                isUndoRedoOperation,
                TRACKABLE_ACTIONS,
                undoStack,
                redoStack,
                getCompleteCanvasState,
                saveToUndoStack
            }}
        >
            {children}
        </CanvasUndoRedoContext.Provider>
    );
};

export const useCanvasUndoRedo = () => {
    const context = useContext(CanvasUndoRedoContext);
    if (!context) {
        throw new Error('useCanvasUndoRedo must be used within a CanvasUndoRedoProvider');
    }
    return context;
};