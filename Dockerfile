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
COPY main.go ./
RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o boardcast .

# Final stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /app/boardcast .
COPY --from=frontend-builder /app/web/build ./web/build
EXPOSE 8080
ENTRYPOINT ["./boardcast"]
CMD ["--port", "8080", "--password", "boardcast"]
