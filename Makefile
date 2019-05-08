
.PHONY: build
build:
	npm run build

.PHONY: publish
publish:
	npm run build && npm publish

.PHONY: test
test:
	npm run test -- --coverage