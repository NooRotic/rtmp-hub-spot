# Summary for Refactoring AdminApp.tsx (Plan 002)

This document outlines the high-level strategy for refactoring the large and complex `AdminApp.tsx` component. The goal is to improve maintainability, testability, and separation of concerns by breaking down the component into smaller, more focused modules.

## The Core Problem

`AdminApp.tsx` currently has too many responsibilities, including:
*   Managing the state of the UI (drawers, panels, etc.).
*   Managing the state of the core application logic (grid members, device selection, etc.).
*   Handling IPC communication with the Electron main process.
*   Orchestrating complex features like synthetic RTMP feeds.
*   Rendering the entire application layout.

## The Refactoring Strategy

The proposed solution is to extract logic and UI into a series of new, more focused custom hooks and components. This will be done in a series of small, incremental steps, each resulting in a cleaner and more modular codebase.

### Phase 1: State and Logic Extraction

The first phase will focus on extracting non-UI logic out of `AdminApp.tsx`.

1.  **`useAdminState` Hook:** A new custom hook will be created to manage the majority of the `useState` calls. This will centralize the component's state management and make `AdminApp` itself much cleaner.
2.  **`useSyntheticFeeds` Hook:** The complex logic for managing synthetic RTMP feeds will be moved into its own dedicated hook. This will isolate this feature and make it easier to test and maintain.

### Phase 2: UI and Layout Extraction

The second phase will focus on breaking down the rendering logic of `AdminApp.tsx`.

1.  **`ZoneManager` Component:** A new component will be created to manage the layout of the different UI "zones" (Top Bar, Stage, Console, Drawers). This will separate the layout from the state management.
2.  **Component-Specific Logic:** Logic that is only used by a single child component will be moved down into that component, rather than being passed down as props from `AdminApp`.

### Phase 3: Data Provider Simplification

The final phase will focus on simplifying the way data is provided to the rest of the application.

1.  **`AdminDataSidecar`:** A new component or hook will be created to manage the creation of the large `adminData` object that is passed to the `AdminDataProvider`.

## Next Steps

This summary provides the high-level approach. The next step would be to create a detailed, step-by-step implementation plan for **Phase 1** of this refactoring effort. Each phase will have its own plan to keep the changes small and manageable.
