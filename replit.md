# ODIN (Optimal Dynamic Interplanetary Navigator) System

## Overview

ODIN is an AI-powered spacecraft trajectory planning system designed for autonomous Earth-to-Moon missions. The system combines advanced orbital mechanics, real-time threat detection, and generative AI decision-making to optimize spacecraft trajectories while ensuring mission safety. Built as a full-stack web application, ODIN provides mission planners with an intuitive interface for planning, monitoring, and managing interplanetary missions with features including Lambert problem solving, Hohmann transfer optimization, space weather monitoring, and multilingual support.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite for development and build tooling
- **UI Library**: Radix UI components with shadcn/ui for consistent design system
- **Styling**: Tailwind CSS with custom ODIN theme featuring space-themed colors (Deep Space Blue, Mission Orange, Lunar Silver)
- **Design System**: Fluent Design principles optimized for enterprise mission-critical applications
- **State Management**: TanStack Query for server state management and React hooks for local state
- **Routing**: Wouter for lightweight client-side routing
- **3D Visualization**: Three.js integration for trajectory and orbital visualization

### Backend Architecture
- **Runtime**: Node.js with Express.js REST API server
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM with PostgreSQL (Neon serverless)
- **Authentication**: Session-based authentication with bcrypt password hashing
- **Build System**: ESBuild for production bundling, tsx for development

### Database Design
- **Users**: Authentication and user management
- **Missions**: Core spacecraft mission tracking with status, progress, and trajectory data
- **Space Weather**: Historical solar activity and space conditions data
- **Threat Events**: Detected threats (solar flares, debris, radiation) with severity scoring
- **AI Decisions**: Logged AI decision-making with reasoning and trade-off analysis
- **Trajectories**: Calculated orbital paths with fuel efficiency and time optimization

### Core Engineering Modules
- **Trajectory Engine**: Implements Lambert's problem solver, Hohmann transfers, and fuel optimization calculations
- **Threat Detection**: Real-time monitoring of solar flares, space debris, and radiation exposure
- **AI Decision Engine**: Integration points for OpenAI/Anthropic APIs for autonomous decision-making
- **Unit Conversion**: Robust conversion between user-friendly units (km, hours) and SI base units for calculations

### Key Features
- **Mission Dashboard**: Real-time mission monitoring with progress tracking and system status
- **3D Trajectory Viewer**: Interactive orbital visualization with phase-based playback controls
- **Threat Monitor**: Live threat detection and risk assessment with probability scoring
- **Decision Log**: AI reasoning documentation with trade-off analysis and confidence metrics
- **Multilingual Support**: i18n ready with English and Hindi language switching

## External Dependencies

### Database Services
- **Neon PostgreSQL**: Serverless PostgreSQL database for production data storage
- **Drizzle Kit**: Database migration and schema management tooling

### UI and Styling
- **Radix UI**: Headless component primitives for accessible UI components
- **Tailwind CSS**: Utility-first CSS framework with custom ODIN design tokens
- **Lucide React**: Icon library for consistent iconography
- **Three.js**: 3D graphics library for orbital trajectory visualization

### Development and Build Tools
- **Vite**: Fast development server and build tool with HMR support
- **TypeScript**: Type safety across frontend and backend codebase
- **ESBuild**: Fast JavaScript bundler for production builds
- **PostCSS**: CSS processing with Autoprefixer for cross-browser compatibility

### Backend Services
- **bcrypt**: Secure password hashing for user authentication
- **TanStack Query**: Server state management with caching and synchronization
- **Express Session**: Session management for user authentication
- **Wouter**: Lightweight client-side routing library

### Future Integration Points
- **NASA APIs**: Space weather data, solar activity monitoring, orbital debris tracking
- **OpenAI/Anthropic**: Generative AI for autonomous trajectory decision-making
- **Real-time Data Feeds**: Live space weather and orbital mechanics data sources