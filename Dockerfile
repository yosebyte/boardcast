# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Build backend
FROM golang:1.21-alpine AS backend-builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o boardcast .

# Final stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /app/boardcast .
COPY --from=frontend-builder /app/web/build ./web/build

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8080

# Set default data directory
ENV DATA_DIR=/app/data

# Volume for persistent data
VOLUME ["/app/data"]

ENTRYPOINT ["./boardcast"]
CMD ["--port", "8080", "--data-dir", "/app/data"]
