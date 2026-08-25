# PostgreSQL Library adapter

Library schema에 대한 하나의 transaction command 경계를 소유한다. command receipt, 현재
Place Preferences, Personal Rating 이력, Collection·Tag membership, 복사 provenance를
기록한다. 공개 조회는 반환 column을 명시하며 개인 preference나 ownership field를 조회하지
않는다.
