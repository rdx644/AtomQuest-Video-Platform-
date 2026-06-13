# AtomQuest Video Support Platform Architecture

This document outlines the architecture and system design choices for the platform.

## System Architecture Diagram

```mermaid
graph TD
    %% Define styles
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef server fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    classDef data fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef webrtc fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,stroke-dasharray: 5 5;

    %% Nodes
    Agent[Agent Browser]:::client
    Customer[Customer Browser]:::client
    Admin[Admin Browser]:::client

    subgraph Node.js Express Server
        API[REST API Router]:::server
        WS[WebSocket Server]:::server
        Auth[Auth Middleware]:::server
        SessionMgr[Session Manager]:::server
        MediaMgr[Media Manager]:::server
        Metrics[Metrics Service]:::server
    end

    subgraph Data Layer
        JSONDB[(JSON Database)]:::data
        FileStore[(Local File System)]:::data
    end

    %% Client to Server Connections
    Agent <-->|HTTPS/REST| API
    Agent <-->|WebSocket| WS
    
    Customer <-->|HTTPS/REST| API
    Customer <-->|WebSocket| WS
    
    Admin <-->|HTTPS/REST| API

    %% Internal Server Connections
    API --> Auth
    WS --> Auth
    API --> SessionMgr
    WS --> SessionMgr
    WS --> MediaMgr
    WS --> Metrics
    API --> Metrics
    
    %% Storage Connections
    SessionMgr <--> JSONDB
    Auth <--> JSONDB
    MediaMgr --> FileStore
    API --> FileStore

    %% WebRTC Connections
    Agent <-.->|WebRTC P2P Media Streams| Customer:::webrtc
```

## Technology Choices

1. **Frontend (Client)**
   - **React with TypeScript**: Chosen for robust component-based UI development and type safety.
   - **Vite**: Used for fast bundling and hot module replacement during development.
   - **React Router**: For client-side routing (Login, Dashboard, Call Room, etc.).
   - **Vanilla CSS**: Used for styling to ensure full control over the dynamic and modern UI design without the overhead of heavy UI frameworks.

2. **Backend (Server)**
   - **Node.js with Express**: A lightweight and unopinionated framework, ideal for handling REST API endpoints and serving static files.
   - **WebSocket (ws)**: Provides real-time bidirectional communication. Critical for WebRTC signaling (exchanging offers, answers, and ICE candidates) and real-time chat.
   - **JSON Web Tokens (JWT)**: Used for stateless, secure authentication and role-based access control (Agent, Customer, Admin).

3. **Data Storage**
   - **File-based JSON Database**: Chosen to simplify deployment and setup during the hackathon. It provides a lightweight, persistent state mechanism for sessions, users, and chat history without requiring external database instances (like PostgreSQL or MongoDB).
   - **Local File System**: Used for storing uploaded chat files and session recordings.

4. **Media and Communications**
   - **WebRTC**: Used for real-time audio and video. WebRTC enables low-latency communication directly between the Agent and the Customer browsers. 
   - **Signaling Server**: The Node.js WebSocket server acts as the signaling relay, orchestrating the initial connection handshake before the browsers establish the P2P media streams.

5. **Observability**
   - **Prometheus Metrics**: Custom middleware tracking API response times, active WebSocket connections, and application events. Exposed via a standard `/metrics` endpoint to allow seamless integration with monitoring stacks like Prometheus and Grafana.

## Design Patterns & Security
- **Separation of Concerns**: Clean boundaries between HTTP REST controllers, WebSocket event handlers, business logic (`sessionManager`), and data access (`database.ts`).
- **Role-Based Access Control**: Strict validation on the backend ensures Customers cannot trigger Agent-only events (e.g., ending a call or starting a recording).
- **Graceful Reconnection**: The `sessionManager` uses memory-based timers to implement the "grace window" feature. If a WebSocket disconnects, the session state is held as `AGENT_WAITING` until the timer expires or the customer reconnects.
