FROM nginxinc/nginx-unprivileged:1.28.2-alpine
COPY index.html /usr/share/nginx/html/
