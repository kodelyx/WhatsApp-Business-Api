# Build stage
FROM golang:1.22-alpine AS builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o main src/webhook.go src/campaign.go src/db.go src/templates.go

# Run stage
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/main .
COPY --from=builder /app/config.json .
COPY --from=builder /app/src/frontend ./src/frontend
EXPOSE 9090
ENV PORT=9090
CMD ["./main"]
